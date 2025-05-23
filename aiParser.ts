import { OpenAI } from 'openai';

interface AIExtractionRequest {
  jsonContent: string[];
  exampleJson: string[];
}

export class aiParser {
  private openAI: OpenAI;

  constructor(apiKey: string) {
    this.openAI = new OpenAI({ apiKey });
  }

  // Method to generate content using OpenAI
  private async callOpenAI(systemRole: string, userPrompt: string, model: string = 'gpt-4o-mini', maxTokens: number = 280): Promise<string> {
    try {
      const response = await this.openAI.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemRole },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: maxTokens
      });

      return response.choices[0].message.content ?? 'No response from AI.';
    } catch (error) {
      console.error('Error generating content:', error);
      return 'An error occurred while generating the content.';
    }
  }

  // Method to generate structured data using OpenAI (returns a JSON object)
  private async extractStructuredData(text: string, request: string, extractionRequest: AIExtractionRequest): Promise<{ [key: string]: string } | null> {
    const jsonKeys = extractionRequest.jsonContent.join(", ");
    const exampleJson = extractionRequest.exampleJson.join("\n");

    const prompt = `${request}.
    Return only a valid JSON object containing the following keys: ${jsonKeys}.
    
    Example format:
    ${exampleJson}
    
    **Text:** ${text}
    
    Respond ONLY with a valid JSON object.`;

    const result = await this.callOpenAI("Extract structured data from the given text.", prompt);
    return this.cleanAIResponse(result);
  }

  private async extractData(text: string, extractionRequest: AIExtractionRequest): Promise<{ [key: string]: string } | null> {
    return await this.extractStructuredData(text, "Analyze the following text and extract the required information", extractionRequest);
  }

  public async extractDate(text: string): Promise<string | null> {
    const extractionRequest: AIExtractionRequest = {
      jsonContent: ["date"],
      exampleJson: ['{ "date": "2025-02-26T14:30:00Z" }']
    };

    const extractedData = await this.extractData(text, extractionRequest);
    console.log(`Date extracted with AI: ${extractedData?.date}`);
    return extractedData?.date || null;
  }

  private cleanAIResponse(response: string): { [key: string]: string } | null {
    const jsonMatch: RegExpMatchArray | null = response.match(/({.*?})/s);
    if (!jsonMatch) {
      console.error('Invalid JSON format received from AI.');
      return null;
    }

    try {
      let cleanedJson = jsonMatch[1].replace(/([{,])\s*([a-zA-Z0-9_]+)\s*:/g, '$1"$2":'); // Ensure property names are quoted
      return JSON.parse(cleanedJson);
    } catch (error) {
      console.error('Error parsing cleaned JSON:', error, `Raw Response: ${response}`);
      return null;
    }
  }
}