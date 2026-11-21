import { prisma } from "@/lib/db";
import { route, fail, qs } from "@/lib/api";

const MAX_CHUNK = 3 * 1024 * 1024; // sous la limite des fonctions serverless (≈ 4,5 Mo utiles)

// Ajoute un morceau au fichier : ?offset=<octets déjà reçus>, corps binaire brut.
// L'offset garantit l'ordre et empêche d'ajouter deux fois le même morceau.
export const POST = route<{ id: string }>(async ({ req, params }) => {
  const offset = Number(qs(req).get("offset") ?? -1);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) fail(400, "Morceau vide.");
  if (buf.length > MAX_CHUNK) fail(413, "Morceau trop volumineux.");
  const doc = await prisma.document.findUnique({ where: { id: params.id }, select: { size: true } });
  if (!doc || doc.size == null) fail(404, "Document introuvable.");
  if (offset < 0 || offset + buf.length > doc!.size!) fail(400, "Morceau hors limites.");
  const n = await prisma.$executeRaw`
    UPDATE "Document" SET data = COALESCE(data, ''::bytea) || ${Buffer.from(buf)}
    WHERE id = ${params.id} AND COALESCE(octet_length(data), 0) = ${offset}`;
  if (n !== 1) fail(409, "Envoi désynchronisé : recommencez l'envoi du fichier.");
  return { received: offset + buf.length, complete: offset + buf.length === doc!.size };
});
