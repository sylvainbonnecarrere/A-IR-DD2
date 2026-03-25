// utils/toolExecutor.ts
import { ToolCall } from '../types';
import { API_BASE_URL } from '../config/api.config';

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

const executePythonToolOnBackend = async (toolName: string, args: object): Promise<object> => {
    const backendUrl = `${API_BASE_URL}/api/execute-python-tool`;
    
    try {
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolName, args }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `Backend server responded with status ${response.status}` }));
            throw new Error(errorData.error || `Backend server error.`);
        }

        const data = await response.json();
        if (data.success) {
            return data.result;
        } else {
            throw new Error(data.error || 'Backend execution failed.');
        }
    } catch (error) {
        const fetchError = `Backend service not available at ${backendUrl}. Python tools are disabled.`;
        console.warn(fetchError, error);
        // Return a graceful degradation instead of throwing an error
        const isFetchError = error instanceof TypeError && error.message.includes('fetch');
        return { 
            error: isFetchError ? 'Backend service not available' : (error as Error).message,
            message: 'Python tools require backend service. Please start the backend server to use Python tools.',
            toolName,
            backendRequired: true
        };
    }
};


export const executeTool = async (toolCall: ToolCall): Promise<object> => {
    console.log(`Executing tool: ${toolCall.name} with args: ${toolCall.arguments}`);
    
    try {
        const args = JSON.parse(toolCall.arguments);
        
        // --- Tool Router ---
        // If the tool name ends with '_py', delegate execution to the backend service.
        if (toolCall.name.endsWith('_py')) {
            return await executePythonToolOnBackend(toolCall.name, args);
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
