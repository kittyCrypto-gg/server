import { describe, expect, test } from "bun:test";
import type { Request, Response } from "express";
import type { ChatMessage } from "../src/kittyChat/types";
import { mutateChatMessage, type ChatMutationContext } from "../src/kittyChat/mutations";
import Chat from "../src/kittyChat";

const message = (id:string, value="hello"):ChatMessage => ({
    msgId:id, id:"user", nick:"nick", msg:value, timestamp:"2026-10-10T12:00:00Z"
});
function fixture(messages:ChatMessage[]=[message("20")]) {
    const order:string[] = [];
    let encrypted = messages;
    const ctx = {
        messageCache:[message("old-cache")],
        clearMessageCache() {order.push("clear");this.messageCache=null;},
        processChatMessages(entries:ChatMessage[],encrypt:boolean) {
            order.push(encrypt?"encrypt":"decrypt");
            return entries;
        },
        async updateFileData(operation:(entries:ChatMessage[])=>Promise<ChatMessage[]>) {
            order.push("update");
            encrypted=await operation(encrypted);
            return encrypted;
        }
    } as ChatMutationContext;
    const request=(data:object)=>({body:data} as Request);
    const http:number[]=[];
    const response={
        status(code:number) {http.push(code);return this;},
        send(data:object){return data;}
    } as unknown as Response;
    return {ctx,request,response,order,http,getStored:()=>encrypted};
}
async function quiet<T>(run:()=>Promise<T>):Promise<T> {
    const log=console.log;
    console.log=()=>undefined;
    try {return await run();}finally{console.log=log;}
}

describe("chat edit/delete shared mutation parity",()=>{
    test("historical class keeps both per-instance mutation method hooks",()=>{
        expect(typeof (Chat.prototype as unknown as Record<string,unknown>)["editMessage"]).toBe("function");
        expect(typeof (Chat.prototype as unknown as Record<string,unknown>)["deleteMessage"]).toBe("function");
    });
    test("edit replaces the selected message with edited flag without mutating the original",async()=>{
        const f=fixture([message("20"),message("40")]);
        const before=f.getStored();
        const result=await quiet(()=>mutateChatMessage(f.ctx,"edit",f.request({
            msgId:"20",sessionToken:"a",ip:"127.0.0.1",newMessage:"changed"
        }),f.response));
        expect(result).toEqual({success:true});
        expect(f.getStored().map(m=>m.msg)).toEqual(["changed","hello"]);
        expect(f.getStored()[0].edited).toBe(true);
        expect(before[0].msg).toBe("hello");
        expect(f.ctx.messageCache).toBe(f.getStored());
        expect(f.order).toEqual(["clear","update","decrypt","encrypt"]);
    });
    test("delete uses the same ownership and persistence ordering without edit-only fields",async()=>{
        const f=fixture([message("20"),message("40")]);
        const result=await quiet(()=>mutateChatMessage(f.ctx,"delete",f.request({
            msgId:"20",sessionToken:"a",ip:"127.0.0.1"
        }),f.response));
        expect(result).toEqual({success:true});
        expect(f.getStored().map(m=>m.msgId)).toEqual(["40"]);
        expect(f.order).toEqual(["clear","update","decrypt","encrypt"]);
    });
    test("missing parameters and absent messages keep original result and cache reset",async()=>{
        const f=fixture();
        expect(await mutateChatMessage(f.ctx,"edit",f.request({
            msgId:"20",sessionToken:"a",ip:"127.0.0.1",newMessage:" "
        }),f.response)).toEqual({error:"Missing required parameters"});
        expect(f.order).toEqual(["clear"]);
        expect(await mutateChatMessage(f.ctx,"delete",f.request({
            msgId:"999",sessionToken:"a",ip:"127.0.0.1"
        }),f.response)).toEqual({error:"Message not found"});
        expect(f.order).toEqual(["clear","clear","update","decrypt"]);
        expect(f.ctx.messageCache).toBeNull();
    });
    test("unauthorised edit and delete return status 403 without writing altered messages",async()=>{
        for(const kind of ["edit","delete"] as const) {
            const f=fixture();
            const before=f.getStored();
            const data={msgId:"21",sessionToken:"a",ip:"127.0.0.1",newMessage:"edited"};
            const result=await mutateChatMessage(f.ctx,kind,f.request(data),f.response);
            expect(result).toEqual({error:"Message not found"});
            expect(f.http).toEqual([]);
            expect(f.getStored()).toBe(before);
        }
        const f=fixture([message("21")]);
        const result=await mutateChatMessage(f.ctx,"delete",f.request({
            msgId:"21",sessionToken:"a",ip:"127.0.0.1"
        }),f.response);
        expect(result).toEqual({error:"Unauthorised"});
        expect(f.http).toEqual([403]);
        expect(f.order).toEqual(["clear","update","decrypt"]);
        expect(f.ctx.messageCache).toBeNull();
    });
    test("bad session BigInt preserves original handler-specific error logs",async()=>{
        const logs:unknown[][]=[],original=console.error;
        console.error=(...args:unknown[])=>logs.push(args);
        try {
            for (const kind of ["edit","delete"] as const) {
                const f=fixture();
                const result=await mutateChatMessage(f.ctx,kind,f.request({
                    msgId:"20",sessionToken:"ZZ",ip:"127.0.0.1",newMessage:"changed"
                }),f.response);
                expect(result).toEqual({error:"Internal Server Error"});
            }
        }finally{console.error=original;}
        expect(logs.map(item=>item[0])).toEqual([
            "❌ Error processing edit request:","❌ Error processing delete request:"
        ]);
    });
});
