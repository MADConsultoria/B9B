const crypto = require("crypto");

const token = process.argv[2];
const pepper = process.env.TOKEN_PEPPER || process.argv[3];

if (!token || !pepper) {
  console.error("Uso: TOKEN_PEPPER=sua_chave node scripts/hash-token.js TOKEN_DO_CLIENTE");
  process.exit(1);
}

const hash = crypto.createHash("sha256").update(`${pepper}:${token}`).digest("hex");
console.log(hash);
