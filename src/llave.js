/**
 * LA LLAVE CON QUE EL GATEWAY LLAMA AL ADAPTER, COMPARADA EN TIEMPO CONSTANTE (28-oct-2026).
 *
 * Antes se comparaba con `!==`, que se para en la primera letra distinta: midiendo cuánto
 * tarda la respuesta, alguien puede ir adivinando la llave letra a letra. `timingSafeEqual`
 * tarda lo mismo acierte o no. Ver «docs-helios/SEGURIDAD P0 - diseno.md», fase 3. Copia del
 * mismo módulo del Adapter.
 */
const crypto = require("crypto");

/** El token de `Authorization: Bearer …`, o cadena vacía. */
function llaveDeLaCabecera(req) {
  const cabecera = String(req?.headers?.authorization || "");
  if (!cabecera.startsWith("Bearer ")) return "";
  return cabecera.slice("Bearer ".length).trim();
}

/**
 * ¿Es la llave buena? SIN LLAVE CONFIGURADA, NUNCA: una llave vacía no abre nada.
 *
 * Se comparan los resúmenes SHA-256 y no las cadenas, porque `timingSafeEqual` exige el
 * mismo largo y comparar primero los largos ya diría cuánto mide la llave.
 */
function mismaLlave(recibida, esperada) {
  const r = String(recibida || "");
  const e = String(esperada || "");
  if (!e || !r) return false;
  const a = crypto.createHash("sha256").update(r).digest();
  const b = crypto.createHash("sha256").update(e).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { llaveDeLaCabecera, mismaLlave };
