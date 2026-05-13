// utils/toolExecutor.ts
import { ToolCall } from '../types';

// Mock function for getting weather
const get_weather = (location: string): object => {
    if (!location || typeof location !== 'string') {
        throw new Error("L'argument 'location' est manquant ou invalide.");
    }
    if (location.toLowerCase().includes("tokyo")) {
        return { location: "Tokyo", temperature: "15°C", condition: "Cloudy" };
    } else if (location.toLowerCase().includes("paris")) {
        return { location: "Paris", temperature: "22°C", condition: "Sunny" };
    } else {
        return { location, temperature: "20°C", condition: "Partly Cloudy" };
    }
};

const get_current_time = (): object => {
    return { currentTime: new Date().toLocaleString() };
};

const buildSandboxRequiredResult = (toolName: string): object => ({
    error: `L'outil '${toolName}' doit etre execute via le sandbox authentifie.`,
    message: "Le fallback legacy direct sur l'hote a ete supprime. Selectionnez un tool moderne et executez-le via le sandbox authentifie.",
    toolName,
    sandboxRequired: true,
    legacyRouteRemoved: true,
});


export const executeTool = async (toolCall: ToolCall): Promise<object> => {
    console.log(`Executing tool: ${toolCall.name} with args: ${toolCall.arguments}`);
    
    try {
        const args = JSON.parse(toolCall.arguments);
        
        // --- Tool Router ---
        // Python tools must now go through the authenticated sandbox path only.
        if (toolCall.name.endsWith('_py')) {
            return buildSandboxRequiredResult(toolCall.name);
        }

        // Otherwise, execute local TypeScript functions
        switch (toolCall.name) {
            case 'get_weather':
                return get_weather(args.location);
            case 'get_current_time':
                return get_current_time();
            default:
                 console.error(`Tool '${toolCall.name}' not found.`);
                 return { error: `Tool '${toolCall.name}' not found.` };
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        console.error(`Error executing tool ${toolCall.name}:`, errorMessage);
        return { error: `Échec de l'exécution de l'outil ${toolCall.name}.`, details: errorMessage };
    }
};
