import { CaptivateChatAPI } from './../api/CaptivateChatAPI';  // Import the CaptivateChatAPI class
import { Conversation } from './../api/Conversation'; // Assuming you have this class exported


async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function test() {
    try {
        const apiKey: string = 'test apikey';  // Replace with your actual API key
        const captivateAPI: CaptivateChatAPI = new CaptivateChatAPI(apiKey);  // Specify 'dev' or 'prod' mode
        // Connect to the WebSocket
        await captivateAPI.connect();
        console.log('Connected to the API!');

        // Create a conversation
        const userId: string = 'index_lance';
        const userBasicInfo = {
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@example.com',
        };
        const userData = { // Additional data if needed
            preference: 'en',
            location: 'US',
        };

        //const conversation: Conversation = await captivateAPI.createConversation(userId, userBasicInfo, userData, 'bot-first');

        const conversation: Conversation = await captivateAPI.getConversation('index_lance_b73fcd8d-ce8c-4dc6-9fa6-6b990430652f');
        console.log(conversation);
        console.log(`Conversation created with ID: ${conversation.getConversationId()}`);

        // Example: Send a message to the bot
        const messageContent: string = 'Hello, how can I help you?';
        await conversation.sendMessage(messageContent);

        // Handle bot messages asynchronously
        conversation.onMessage((message: string, type: string) => {
            console.log(`Received message: from ${type}`, message);
        });

        conversation.onActionReceived((id: string, data: any) => {
            console.log(`Received Action: ${id}`, data);
        });
        // Example: Set metadata (optional)
        const metadata = {
            sessionId: 'session-1234',
            userRole: 'customer',
        };
        await conversation.setMetadata(metadata);
        console.log('Metadata set successfully.');

        // Example: Send an action (optional, like a button click or custom event)
        const actionId: string = 'action-xyz';
        await conversation.sendAction(actionId, { buttonClicked: true });
        console.log('Action sent successfully.');

        // Request transcript
        await sleep(2000);  // Introduce a delay before requesting the transcript
        const transcript = await conversation.getTranscript();
        console.log('Full Transcript:', transcript);

    } catch (error) {
        console.error('Error:', error);
    }
}


test();