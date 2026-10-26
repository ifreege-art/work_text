export async function resolve(spec, ctx, next) {
  if (spec === '@netlify/blobs') return { url: new URL('./fake-blobs.mjs', import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
