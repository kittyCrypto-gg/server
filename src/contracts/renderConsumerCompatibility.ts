import { renderPage, handleRenderRequest, closeRenderBrowser } from "../render";
import type { RenderConfig, RenderJob, RenderResult } from "../render/types";

const one: (job: RenderJob, config?: RenderConfig) => Promise<RenderResult> = renderPage;
const two: (request: Request, config?: RenderConfig) => Promise<Response> = handleRenderRequest;
const three: () => Promise<void> = closeRenderBrowser;
void one;
void two;
void three;
