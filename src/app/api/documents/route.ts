import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { route, qs, fail, body } from "@/lib/api";

const MAX = 10 * 1024 * 1024; // 10 Mo par fichier
const ALLOWED = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|application\/vnd\.ms-excel|application\/vnd\.oasis\.opendocument\.(text|spreadsheet)|image\/(png|jpeg|gif|webp)|text\/plain)$/;

function guessType(mime: string, name: string) {
  if (mime === "application/pdf") return "PDF";
  if (/word|opendocument\.text/.test(mime) || /\.docx?$/i.test(name)) return "WORD";
  if (/sheet|excel/.test(mime) || /\.xlsx?$/i.test(name)) return "EXCEL";
  if (mime.startsWith("image/")) return "IMAGE";
  return "OTHER";
}

export const GET = route(async ({ req }) => {
  const p = qs(req);
  const q = p.get("q")?.trim();
  const where: Prisma.DocumentWhereInput = {
    ...(p.get("studentId") ? { studentId: p.get("studentId")! } : {}),
    ...(p.get("subjectId") ? { subjectId: p.get("subjectId")! } : {}),
    ...(p.get("levelId") ? { levelId: p.get("levelId")! } : {}),
    ...(p.get("chapterId") ? { chapterId: p.get("chapterId")! } : {}),
    ...(p.get("lessonId") ? { lessonId: p.get("lessonId")! } : {}),
    ...(p.get("type") ? { type: p.get("type")! } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { tags: { contains: q, mode: "insensitive" } }] } : {}),
  };
  return prisma.document.findMany({
    where,
    select: {
      id: true, name: true, type: true, mimeType: true, size: true, url: true, tags: true, createdAt: true,
      student: { select: { id: true, firstName: true, lastName: true } }, subject: { select: { id: true, name: true, color: true } },
      level: { select: { id: true, name: true } }, chapter: { select: { id: true, title: true } }, lesson: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
});

const opt = z.string().optional().nullable().transform((v) => (v ? v : null));
const initSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mimeType: z.string().max(200),
  size: z.number().int().min(1, "Fichier vide.").max(MAX, "Fichier trop volumineux (10 Mo maximum)."),
  type: opt, tags: opt, studentId: opt, subjectId: opt, levelId: opt, chapterId: opt, lessonId: opt,
});

/**
 * Deux modes :
 *  - JSON : début d'un envoi de fichier en plusieurs morceaux (voir /api/documents/[id]/chunk).
 *    Les hébergeurs serverless (Netlify, Vercel) limitent une requête à ~4,5–6 Mo.
 *  - multipart : lien externe (ou petit fichier) en une seule requête.
 */
export const POST = route(async ({ req }) => {
  if (req.headers.get("content-type")?.includes("application/json")) {
    const v = await body(req, initSchema);
    if (!ALLOWED.test(v.mimeType)) fail(415, "Format non accepté. Formats : PDF, Word, Excel, PowerPoint, images, texte.");
    return prisma.document.create({
      data: { ...v, type: v.type || guessType(v.mimeType, v.name), data: new Uint8Array(0) },
      select: { id: true, name: true },
    });
  }
  // Envoi multipart : file (facultatif si url), name, type, tags, studentId, subjectId, levelId, chapterId, lessonId
  const form = await req.formData();
  const file = form.get("file");
  const url = String(form.get("url") ?? "").trim() || null;
  const s = (k: string) => (String(form.get(k) ?? "").trim() || null);
  let data: Uint8Array<ArrayBuffer> | null = null, mimeType: string | null = null, size: number | null = null;
  let name = s("name");
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > MAX) fail(413, "Fichier trop volumineux (10 Mo maximum).");
    if (!ALLOWED.test(file.type)) fail(415, "Format non accepté. Formats : PDF, Word, Excel, PowerPoint, images, texte.");
    data = new Uint8Array(await file.arrayBuffer());
    mimeType = file.type;
    size = file.size;
    name = name || file.name;
  } else if (!url) fail(400, "Choisissez un fichier ou indiquez un lien.");
  if (url && !/^https?:\/\//i.test(url)) fail(400, "Le lien doit commencer par http:// ou https://");
  const type = s("type") || (mimeType ? guessType(mimeType, name ?? "") : "LINK");
  const doc = await prisma.document.create({
    data: { name: (name || url || "Document").slice(0, 200), type, mimeType, size, data, url, tags: s("tags"), studentId: s("studentId"), subjectId: s("subjectId"), levelId: s("levelId"), chapterId: s("chapterId"), lessonId: s("lessonId") },
    select: { id: true, name: true },
  });
  return doc;
});
