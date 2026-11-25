import * as SecureStore from 'expo-secure-store';

/**
 * Firebase Auth persistence backed by Android Keystore (expo-secure-store).
 * SecureStore values should stay < 2 KB, so long values are chunked.
 * Only the Firebase session lives here — never Stitch/Gemini keys (those stay on the server).
 */
const CHUNK = 1800;
const k = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const n = await SecureStore.getItemAsync(`${k(key)}__n`);
    if (!n) return SecureStore.getItemAsync(k(key));
    const parts = await Promise.all(Array.from({ length: Number(n) }, (_, i) => SecureStore.getItemAsync(`${k(key)}__${i}`)));
    return parts.some((p) => p == null) ? null : parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    await this.removeItem(key);
    if (value.length <= CHUNK) return SecureStore.setItemAsync(k(key), value);
    const parts = value.match(new RegExp(`.{1,${CHUNK}}`, 'gs')) ?? [];
    await Promise.all(parts.map((p, i) => SecureStore.setItemAsync(`${k(key)}__${i}`, p)));
    await SecureStore.setItemAsync(`${k(key)}__n`, String(parts.length));
  },
  async removeItem(key: string): Promise<void> {
    const n = await SecureStore.getItemAsync(`${k(key)}__n`);
    if (n) await Promise.all(Array.from({ length: Number(n) }, (_, i) => SecureStore.deleteItemAsync(`${k(key)}__${i}`)));
    await SecureStore.deleteItemAsync(`${k(key)}__n`);
    await SecureStore.deleteItemAsync(k(key));
  },
};
