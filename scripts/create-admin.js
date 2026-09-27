// Crée (ou met à jour) le compte administrateur.
// Utilisation : node scripts/create-admin.js identifiant motdepasse
const path = require('path');
const bcrypt = require('bcryptjs');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');
const adapter = new FileSync(DB_FILE);
const db = low(adapter);
db.defaults({ demandes: [], messages: [], admins: [], nextId: 1 }).write();

const [, , identifiant, motDePasse] = process.argv;

if (!identifiant || !motDePasse) {
  console.log('Utilisation : node scripts/create-admin.js <identifiant> <mot_de_passe>');
  process.exit(1);
}
if (motDePasse.length < 8) {
  console.log('Le mot de passe doit contenir au moins 8 caractères.');
  process.exit(1);
}

const motDePasseHash = bcrypt.hashSync(motDePasse, 10);
const existant = db.get('admins').find({ identifiant }).value();

if (existant) {
  db.get('admins').find({ identifiant }).assign({ motDePasseHash }).write();
  console.log(`Mot de passe mis à jour pour l'administrateur "${identifiant}".`);
} else {
  db.get('admins').push({ identifiant, motDePasseHash }).write();
  console.log(`Compte administrateur "${identifiant}" créé avec succès.`);
}
