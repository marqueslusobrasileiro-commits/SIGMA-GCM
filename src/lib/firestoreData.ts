import type {
  CollectionReference,
  DocumentReference,
  DocumentData,
  SetOptions,
} from 'firebase/firestore';
import { addDoc, setDoc, updateDoc } from 'firebase/firestore';

/**
 * Remove propriedades com valor `undefined` — o Firestore rejeita `undefined` em documentos.
 * Objetos aninhados não são percorridos; normalize valores internos antes se necessário.
 */
export function limparDados<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const novo: Record<string, unknown> = {};
  Object.keys(obj).forEach((key) => {
    const v = obj[key];
    if (v !== undefined) {
      novo[key] = v;
    }
  });
  return novo;
}

type PlainFirestoreData = Record<string, unknown>;

export async function addDocClean<T extends DocumentData>(
  ref: CollectionReference<T>,
  data: PlainFirestoreData,
) {
  return addDoc(ref, limparDados(data) as unknown as T);
}

export async function setDocClean<T extends DocumentData>(
  ref: DocumentReference<T>,
  data: PlainFirestoreData,
  options?: SetOptions,
) {
  return setDoc(ref, limparDados(data) as unknown as T, options as any);
}

export async function updateDocClean<T extends DocumentData>(
  ref: DocumentReference<T>,
  data: PlainFirestoreData,
) {
  return updateDoc(ref as any, limparDados(data));
}
