!function(e,t){"object"==typeof exports&&"object"==typeof module?module.exports=t():"function"==typeof define&&define.amd?define([],t):"object"==typeof exports?exports.CaptivateChatAPI=t():e.CaptivateChatAPI=t()}(this,(()=>(()=>{"use strict";var e={86:function(e,t,n){var o=this&&this.__awaiter||function(e,t,n,o){return new(n||(n=Promise))((function(s,r){function i(e){try{c(o.next(e))}catch(e){r(e)}}function a(e){try{c(o.throw(e))}catch(e){r(e)}}function c(e){var t;e.done?s(e.value):(t=e.value,t instanceof n?t:new n((function(e){e(t)}))).then(i,a)}c((o=o.apply(e,t||[])).next())}))};Object.defineProperty(t,"__esModule",{value:!0}),t.CaptivateChatAPI=void 0;const s=n(52);let r;if("undefined"!=typeof window&&window.WebSocket)r=window.WebSocket;else if(void 0!==n.g&&n.g.WebSocket)r=n.g.WebSocket;else try{r=n(591)}catch(e){throw new Error("WebSocket not available in this environment and ws module could not be loaded")}t.CaptivateChatAPI=class{constructor(e,t="prod"){this.apiKey=e,this.mode=t,this.url="prod"===this.mode?`wss://channel.wss.captivatechat.ai/dev?apiKey=${e}`:`wss://channel-dev.wss.captivatechat.ai/dev?apiKey=${e}`,this.socket=null,this.conversations=new Map}_send(e){this.socket&&this.socket.readyState===r.OPEN?this.socket.send(JSON.stringify(e)):console.error("Socket is not open. Message not sent:",e)}connect(){return o(this,void 0,void 0,(function*(){return new Promise(((e,t)=>{try{this.socket=new r(this.url);const n=setTimeout((()=>{t(new Error("Connection timeout: socket_connected not received"))}),1e4);this.socket.onopen=()=>{console.log("WebSocket connected, waiting for API confirmation...")},this.socket.onmessage=t=>{var o;try{"socket_connected"===(null===(o=JSON.parse(t.data.toString()).event)||void 0===o?void 0:o.event_type)&&(console.log("API Successfully Connected"),clearTimeout(n),e())}catch(e){console.error("Error parsing message:",e)}},this.socket.onerror=e=>{console.error("WebSocket Error:",e.message||e),clearTimeout(n),t(new Error(e.message||"WebSocket error"))},this.socket.onclose=()=>{console.log("WebSocket connection closed")}}catch(e){t(e)}}))}))}createConversation(e){return o(this,arguments,void 0,(function*(e,t={},n={},o="bot-first"){return new Promise(((r,i)=>{var a;try{this._send({action:"sendMessage",event:{event_type:"conversation_start",event_payload:{userId:e,userBasicInfo:t,userData:n}}});const c=e=>{var t,n;try{const a=JSON.parse(e.data.toString());if("conversation_start_success"===(null===(t=a.event)||void 0===t?void 0:t.event_type)){const e=a.event.event_payload.conversation_id;null===(n=this.socket)||void 0===n||n.removeEventListener("message",c);const t=new s.Conversation(e,this.socket);this.conversations.set(e,t),"bot-first"===o?t.sendMessage("").then((()=>r(t))).catch(i):r(t)}}catch(e){console.error("Error processing message:",e)}};null===(a=this.socket)||void 0===a||a.addEventListener("message",c),setTimeout((()=>{var e;null===(e=this.socket)||void 0===e||e.removeEventListener("message",c),i(new Error("Timeout: No response for createConversation"))}),1e4)}catch(e){i(e)}}))}))}getConversation(e){let t=this.conversations.get(e);if(!t){if(null===this.socket)throw console.error("Socket is not initialized"),new Error("WebSocket connection not established");t=new s.Conversation(e,this.socket),this.conversations.set(e,t)}return t}getUserConversations(e){return o(this,void 0,void 0,(function*(){return new Promise(((t,n)=>{var o;try{this._send({action:"sendMessage",event:{event_type:"get_user_conversations",event_payload:{userId:e}}});const s=e=>{var o,r;try{const n=JSON.parse(e.data.toString());"user_conversations"===(null===(o=n.event)||void 0===o?void 0:o.event_type)&&(null===(r=this.socket)||void 0===r||r.removeEventListener("message",s),t(n.event.event_payload.conversations))}catch(e){console.error("Error processing message:",e),n(e)}};null===(o=this.socket)||void 0===o||o.addEventListener("message",s),setTimeout((()=>{var e;null===(e=this.socket)||void 0===e||e.removeEventListener("message",s),n(new Error("Timeout: No response for getUserConversations"))}),1e4)}catch(e){n(e)}}))}))}}},52:function(e,t){var n=this&&this.__awaiter||function(e,t,n,o){return new(n||(n=Promise))((function(s,r){function i(e){try{c(o.next(e))}catch(e){r(e)}}function a(e){try{c(o.throw(e))}catch(e){r(e)}}function c(e){var t;e.done?s(e.value):(t=e.value,t instanceof n?t:new n((function(e){e(t)}))).then(i,a)}c((o=o.apply(e,t||[])).next())}))};Object.defineProperty(t,"__esModule",{value:!0}),t.Conversation=void 0,t.Conversation=class{constructor(e,t){this.conversationId=e,this.socket=t,this.listeners=new Map,this.socket.onmessage=e=>{var t,n;const o=JSON.parse(e.data),s=null===(t=o.event)||void 0===t?void 0:t.event_type;if(s&&this.listeners.has(s)){const e=o.event.event_payload;null===(n=this.listeners.get(s))||void 0===n||n.forEach((t=>t(e)))}}}addListener(e,t){var n;this.listeners.has(e)||this.listeners.set(e,[]),null===(n=this.listeners.get(e))||void 0===n||n.push(t)}onMessage(e){this.addListener("bot_message",(t=>e(t.content,"ai_agent"))),this.addListener("livechat_message",(t=>e(t.content,"human_agent")))}onActionReceived(e){this.addListener("action",(t=>e(t.id,t.data)))}onConversationUpdate(e){this.addListener("conversation_update",(t=>{e({type:t.type,conversationId:t.conversation_id,data:t.data})}))}onError(e){this.addListener("general_error",(t=>{e({conversationId:t.conversation_id,errorCode:t.error_code,errorDesc:t.error_desc})}))}sendMessage(e){return n(this,void 0,void 0,(function*(){return this.sendPayload("user_message",{type:"message_create",client_msg_id:`unique-message-id-${Date.now()}`,conversation_id:this.conversationId,content:e})}))}setMetadata(e){return n(this,void 0,void 0,(function*(){return this.sendPayload("metadata",{metadata:e,client_msg_id:`metadata-${Date.now()}`,conversation_id:this.conversationId})}))}sendAction(e){return n(this,arguments,void 0,(function*(e,t={}){return this.sendPayload("action",{type:"normal",id:e,data:t,conversation_id:this.conversationId})}))}getTranscript(){return n(this,void 0,void 0,(function*(){return new Promise(((e,t)=>{const n={action:"sendMessage",event:{event_type:"conversation_transcript_request",event_payload:{conversation_id:this.conversationId}}};this.socket.send(JSON.stringify(n));const o=t=>{t.conversation_id===this.conversationId&&(this.removeListener("conversation_transcript",o),e(t.transcript))};this.addListener("conversation_transcript",o),setTimeout((()=>{this.removeListener("conversation_transcript",o),t(new Error("Timeout: No response for transcript request"))}),1e4)}))}))}getMetadata(){return n(this,void 0,void 0,(function*(){return new Promise(((e,t)=>{const n={action:"sendMessage",event:{event_type:"metadata_request",event_payload:{conversation_id:this.conversationId}}};this.socket.send(JSON.stringify(n));const o=t=>{console.log(t),t.conversation_id===this.conversationId&&(this.removeListener("conversation_metadata",o),e(t.content))};this.addListener("conversation_metadata",o),setTimeout((()=>{this.removeListener("conversation_metadata",o),t(new Error("Timeout: No response for metadata request"))}),1e4)}))}))}sendPayload(e,t){return n(this,void 0,void 0,(function*(){return new Promise(((n,o)=>{try{const o={action:"sendMessage",event:{event_type:e,event_payload:t}};this.socket.send(JSON.stringify(o)),n()}catch(e){o(e)}}))}))}removeListener(e,t){const n=this.listeners.get(e);n&&this.listeners.set(e,n.filter((e=>e!==t)))}getConversationId(){return this.conversationId}}},591:e=>{e.exports=function(){throw new Error("ws does not work in the browser. Browser clients must use the native WebSocket object")}}},t={};function n(o){var s=t[o];if(void 0!==s)return s.exports;var r=t[o]={exports:{}};return e[o].call(r.exports,r,r.exports,n),r.exports}n.g=function(){if("object"==typeof globalThis)return globalThis;try{return this||new Function("return this")()}catch(e){if("object"==typeof window)return window}}();var o={};return(()=>{var e=o;const t=n(86);e.default=t.CaptivateChatAPI})(),o.default})()));