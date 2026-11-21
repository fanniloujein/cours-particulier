"use client";
// Envoi de fichiers par morceaux de 2 Mo : contourne la limite de taille des requêtes
// des hébergeurs serverless (Netlify ≈ 6 Mo, base64 compris).
import { api, ApiError } from "./client";

const CHUNK = 2 * 1024 * 1024;
export const MAX_FILE = 10 * 1024 * 1024;

const BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export type UploadMeta = Partial<Record<"name" | "type" | "tags" | "studentId" | "subjectId" | "levelId" | "chapterId" | "lessonId", string | null>>;

export async function uploadDocument(file: File, meta: UploadMeta = {}, onProgress?: (ratio: number) => void) {
  if (file.size > MAX_FILE) throw new ApiError(413, "Fichier trop volumineux (10 Mo maximum).");
  const mimeType = file.type || BY_EXT[file.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";
  const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v));
  const doc = await api<{ id: string; name: string }>("/api/documents", {
    body: { ...clean, name: meta.name || file.name, mimeType, size: file.size },
  });
  try {
    for (let offset = 0; offset < file.size; offset += CHUNK) {
      const res = await fetch(`/api/documents/${doc.id}/chunk?offset=${offset}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file.slice(offset, offset + CHUNK),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new ApiError(res.status, j?.error ?? `Envoi interrompu (erreur ${res.status}).`);
      }
      onProgress?.(Math.min(1, (offset + CHUNK) / file.size));
    }
  } catch (e) {
    // Pas de document à moitié envoyé dans la bibliothèque
    await fetch(`/api/documents/${doc.id}`, { method: "DELETE" }).catch(() => {});
    throw e;
  }
  return doc;
}
