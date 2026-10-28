/**
 * EL TOKEN DEL MCP DE CAL.COM: EN TIEMPO CONSTANTE, Y SIN TOKEN CONFIGURADO NO ENTRA NADIE
 * (28-oct-2026). Ver «docs-helios/SEGURIDAD P0 - diseno.md», fase 3.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { llaveDeLaCabecera, mismaLlave } = require('../src/llave');

assert.equal(mismaLlave('tok', 'tok'), true);
assert.equal(mismaLlave('tok2', 'tok'), false);
assert.equal(mismaLlave('', undefined), false, 'SIN TOKEN CONFIGURADO, ENTRABA UNA PETICIÓN SIN TOKEN');
assert.equal(mismaLlave('undefined', undefined), false, '«Bearer undefined» no puede abrir nada');
assert.equal(llaveDeLaCabecera({ headers: { authorization: 'Bearer tok' } }), 'tok');

const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
assert.match(index, /if \(!mismaLlave\(llaveDeLaCabecera\(req\), CALCOM_MCP_TOKEN\)\)/, 'el middleware no usa mismaLlave');
assert.doesNotMatch(index, /token !== CALCOM_MCP_TOKEN/, 'queda la comparación con !==');

// EL `.dockerignore`: el Dockerfile hace `COPY . .` y sin él entraría un `.env` local.
const ignorados = fs.readFileSync(path.join(__dirname, '..', '.dockerignore'), 'utf8');
for (const x of ['.env', 'node_modules', '.git']) assert.ok(ignorados.split(/\r?\n/).includes(x), 'falta en .dockerignore: ' + x);

console.log('llave_test: OK');
