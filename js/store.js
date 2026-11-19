// Data layer. Two interchangeable backends:
//   cloud  – Firebase Auth + Firestore (used when firebase-config.js is filled in)
//   local  – localStorage in this browser (demo / try-out mode)
import { firebaseConfig } from './firebase-config.js';

export const cloudMode = !!(firebaseConfig && firebaseConfig.apiKey);

const DEFAULT_SETTINGS = { currency: 'INR', autoLockMinutes: 15, budgets: {} };

export const state = {
  ready: false,      // auth state known
  loaded: false,     // data loaded
  user: null,        // { email, uid }
  error: '',
  accounts: [],
  transactions: [],
  settings: { ...DEFAULT_SETTINGS },
};

const listeners = new Set();
const noticeListeners = new Set();
export const subscribe = fn => listeners.add(fn);
export const onNotice = fn => noticeListeners.add(fn);
const emit = () => listeners.forEach(fn => fn(state));
const notice = msg => noticeListeners.forEach(fn => fn(msg));

let backend;

export async function init() {
  backend = cloudMode ? await createCloud() : createLocal();
  await backend.init();
}

/* ---------- public operations ---------- */

export const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '');

const strip = o => JSON.parse(JSON.stringify(o)); // drops undefined

export function saveAccount(acc) {
  const { id = newId(), ...data } = acc;
  if (!data.createdAt) data.createdAt = Date.now();
  backend.apply([{ op: 'set', col: 'accounts', id, data: strip(data) }]);
  return id;
}

/** Deletes the account AND every transaction that touches it. */
export function deleteAccount(id) {
  const ops = state.transactions
    .filter(t => t.accountId === id || t.toAccountId === id)
    .map(t => ({ op: 'del', col: 'transactions', id: t.id }));
  ops.push({ op: 'del', col: 'accounts', id });
  backend.apply(ops);
}

export function saveTransaction(tx) {
  const { id = newId(), ...data } = tx;
  if (!data.createdAt) data.createdAt = Date.now();
  backend.apply([{ op: 'set', col: 'transactions', id, data: strip(data) }]);
  return id;
}

export function deleteTransaction(id) {
  backend.apply([{ op: 'del', col: 'transactions', id }]);
}

export function saveSettings(patch) {
  const data = strip({ ...state.settings, ...patch });
  backend.apply([{ op: 'set', col: 'meta', id: 'settings', data }]);
}

/** Replace everything with the contents of a backup. */
export function replaceAll({ accounts, transactions, settings }) {
  const ops = [
    ...state.transactions.map(t => ({ op: 'del', col: 'transactions', id: t.id })),
    ...state.accounts.map(a => ({ op: 'del', col: 'accounts', id: a.id })),
    ...accounts.map(({ id, ...data }) => ({ op: 'set', col: 'accounts', id, data })),
    ...transactions.map(({ id, ...data }) => ({ op: 'set', col: 'transactions', id, data })),
    { op: 'set', col: 'meta', id: 'settings', data: strip({ ...DEFAULT_SETTINGS, ...settings }) },
  ];
  backend.apply(ops);
}

export const signIn = (email, password, remember) => backend.signIn(email, password, remember);
export const signOut = () => backend.signOut();
export const resetPassword = email => backend.resetPassword(email);

/* ---------- local backend ---------- */

function createLocal() {
  const KEY = 'ams-data-v1';
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        accounts: state.accounts, transactions: state.transactions, settings: state.settings,
      }));
    } catch (e) { notice('Could not save to this browser: ' + e.message); }
  };
  return {
    async init() {
      try {
        const d = JSON.parse(localStorage.getItem(KEY) || '{}');
        state.accounts = d.accounts || [];
        state.transactions = d.transactions || [];
        state.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
      } catch { /* start empty */ }
      state.user = { email: 'Local mode', uid: 'local', local: true };
      state.ready = state.loaded = true;
      emit();
    },
    apply(ops) {
      for (const o of ops) {
        if (o.col === 'meta') { state.settings = { ...DEFAULT_SETTINGS, ...o.data }; continue; }
        const list = state[o.col].filter(x => x.id !== o.id);
        if (o.op === 'set') list.push({ id: o.id, ...o.data });
        state[o.col] = list;
      }
      persist();
      emit();
    },
    async signIn() {},
    async signOut() {},
    async resetPassword() {},
  };
}

/* ---------- cloud backend (Firebase) ---------- */

async function createCloud() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import('../vendor/firebase-app.js'),
    import('../vendor/firebase-auth.js'),
    import('../vendor/firebase-firestore.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  let db;
  try {
    // Offline cache: the app keeps working without a connection and syncs later.
    db = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
    });
  } catch {
    db = F.getFirestore(app);
  }

  let unsubs = [];
  const stop = () => { unsubs.forEach(u => u()); unsubs = []; };
  const uid = () => auth.currentUser.uid;
  const ref = (col, id) => F.doc(db, 'users', uid(), col, id);

  const fail = e => {
    console.error(e);
    notice(e?.code === 'permission-denied'
      ? 'Access denied by the database rules. Check that your UID is set in firestore.rules.'
      : 'Could not save: ' + (e?.message || e));
  };

  function start() {
    const pending = new Set(['accounts', 'transactions', 'settings']);
    const done = key => { pending.delete(key); if (!pending.size) state.loaded = true; emit(); };
    const onErr = e => {
      console.error(e);
      state.error = e?.code === 'permission-denied'
        ? 'This login is not allowed to read the database. Check that firestore.rules contains your UID and is published.'
        : 'Could not load data: ' + (e?.message || e);
      state.loaded = true;
      emit();
    };
    for (const col of ['accounts', 'transactions']) {
      unsubs.push(F.onSnapshot(F.collection(db, 'users', uid(), col), snap => {
        state[col] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        done(col);
      }, onErr));
    }
    unsubs.push(F.onSnapshot(ref('meta', 'settings'), snap => {
      state.settings = { ...DEFAULT_SETTINGS, ...(snap.data() || {}) };
      done('settings');
    }, onErr));
  }

  return {
    init() {
      return new Promise(resolve => {
        A.onAuthStateChanged(auth, user => {
          stop();
          state.error = '';
          state.loaded = false;
          state.accounts = [];
          state.transactions = [];
          state.user = user ? { email: user.email, uid: user.uid } : null;
          state.ready = true;
          if (user) start();
          emit();
          resolve();
        });
      });
    },
    apply(ops) {
      if (ops.length === 1) {
        const o = ops[0];
        const p = o.op === 'set' ? F.setDoc(ref(o.col, o.id), o.data) : F.deleteDoc(ref(o.col, o.id));
        p.catch(fail);
        return;
      }
      // Firestore batches are limited to 500 writes.
      for (let i = 0; i < ops.length; i += 400) {
        const batch = F.writeBatch(db);
        for (const o of ops.slice(i, i + 400)) {
          if (o.op === 'set') batch.set(ref(o.col, o.id), o.data);
          else batch.delete(ref(o.col, o.id));
        }
        batch.commit().catch(fail);
      }
    },
    async signIn(email, password, remember) {
      await A.setPersistence(auth, remember ? A.browserLocalPersistence : A.browserSessionPersistence);
      await A.signInWithEmailAndPassword(auth, email, password);
    },
    async signOut() {
      stop();
      await A.signOut(auth);
      // Wipe the offline copy of the data from this device.
      try { await F.terminate(db); await F.clearIndexedDbPersistence(db); } catch { /* best effort */ }
      location.reload();
    },
    resetPassword: email => A.sendPasswordResetEmail(auth, email),
  };
}
