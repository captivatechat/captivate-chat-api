// One screen of an Expo app on captivate-chat-api's Blue mode: send a message, watch the answer
// while it's written, Stop it, and read a dropped answer back when the app comes to the front.
import { useEffect, useRef, useState } from 'react';
import { AppState, Button, FlatList, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { CaptivateChatAPI } from 'captivate-chat-api';

// Your app's key from Blue's Channels page ("Your own app"). This one is a placeholder.
const APP_KEY = 'vba_000000000000000000000000';
// 'dev' for Blue's dev backend; options.blueUrl for any other address.
const MODE = 'dev';
// Your app's own ID for the person using it. Blue keeps their conversations under a secret made
// for this ID and kept in AsyncStorage, never under the ID itself.
const USER_ID = 'example-user';

export default function App() {
  const conversation = useRef(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [step, setStep] = useState('');
  const [text, setText] = useState('');
  const [answering, setAnswering] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let api = null;
    (async () => {
      try {
        api = await CaptivateChatAPI.create(APP_KEY, MODE, {
          storage: AsyncStorage,
          // Hermes has no crypto.getRandomValues.
          randomValues: (bytes) => Crypto.getRandomValues(bytes),
        });
        const chat = await api.createConversation(USER_ID, {}, {}, 'bot-first');
        chat.onStep((label) => setStep(label));
        chat.onDelta((soFar) => setDraft(soFar));
        chat.onAnswer(({ text: answer, sources, stopped }) => {
          setMessages((list) => [...list, { id: String(list.length), from: 'bot', text: answer, sources: stopped ? [] : sources }]);
          setDraft('');
          setStep('');
          setAnswering(false);
        });
        chat.onError(({ errorDesc }) => {
          setProblem(errorDesc);
          setDraft('');
          setStep('');
          setAnswering(false);
        });
        conversation.current = chat;
      } catch (error) {
        setProblem(error.errorDesc || error.message);
      }
    })();
    // Phones pause connections in the background: read back an answer still pending.
    const listening = AppState.addEventListener('change', (state) => {
      if (state === 'active') conversation.current?.resume();
    });
    return () => {
      listening.remove();
      api?.dispose();
    };
  }, []);

  async function send() {
    const chat = conversation.current;
    const message = text.trim();
    if (!chat || !message) return;
    setText('');
    setProblem('');
    setMessages((list) => [...list, { id: String(list.length), from: 'you', text: message, sources: [] }]);
    setAnswering(true);
    try {
      await chat.sendMessage(message);
    } catch (error) {
      setProblem(error.errorDesc || error.message);
      setAnswering(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.from === 'you' ? styles.you : styles.bot]}>
              <Text style={styles.words}>{item.text}</Text>
              {item.sources.map((source) => (
                <Text key={source.number} style={styles.source}>
                  [{source.number}] {source.title || 'Internal document'}
                </Text>
              ))}
            </View>
          )}
          ListFooterComponent={
            answering ? (
              <View style={[styles.bubble, styles.bot]}>
                <Text style={styles.words}>{draft || step || '…'}</Text>
              </View>
            ) : null
          }
        />
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <View style={styles.box}>
          <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Type a message" onSubmitEditing={send} />
          {answering ? <Button title="Stop" onPress={() => conversation.current?.stop()} /> : <Button title="Send" onPress={send} />}
        </View>
      </KeyboardAvoidingView>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  list: { padding: 16, gap: 8 },
  bubble: { padding: 12, borderRadius: 12, maxWidth: '85%' },
  you: { alignSelf: 'flex-end', backgroundColor: '#dbe8ff' },
  bot: { alignSelf: 'flex-start', backgroundColor: '#f1f1f1' },
  words: { fontSize: 16, color: '#111' },
  source: { fontSize: 13, color: '#555', marginTop: 4 },
  problem: { color: '#a40000', paddingHorizontal: 16, paddingBottom: 8 },
  box: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8, borderTopWidth: 1, borderColor: '#ddd' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16 },
});
