// ============================================================
// FARHEL-EXPRESS — Backend API
// Express + lowdb (base de données fichier JSON) + JWT + bcrypt
// ============================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const DB_FILE = path.join(__dirname, 'data', 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const adapter = new FileSync(DB_FILE);
const db = low(adapter);
db.defaults({ demandes: [], messages: [], admins: [], nextId: 1 }).write();

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-.env';
const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  }
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

function nextId() {
  const id = db.get('nextId').value();
  db.set('nextId', id + 1).write();
  return id;
}

// ---------- Auth middleware pour l'espace admin ----------
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session invalide ou expirée.' });
  }
}

// ============================================================
// ROUTES PUBLIQUES — Espace client
// ============================================================

// Créer une nouvelle demande de travail (avec fichier joint optionnel)
app.post('/api/demandes', upload.single('fichier'), (req, res) => {
  const { nom, telephone, email, typeTravail, sujet, pages, delai, description } = req.body;
  if (!nom || !telephone || !typeTravail || !sujet) {
    return res.status(400).json({ error: 'Nom, téléphone, type de travail et sujet sont obligatoires.' });
  }
  const demande = {
    id: nextId(),
    nom, telephone, email: email || '', typeTravail, sujet,
    pages: pages || '', delai: delai || '', description: description || '',
    fichier: req.file ? `/uploads/${req.file.filename}` : null,
    statut: 'En attente', // En attente | En cours | Terminé | Annulé
    reponses: [],
    dateCreation: new Date().toISOString()
  };
  db.get('demandes').push(demande).write();
  res.status(201).json({ message: 'Votre demande a bien été envoyée. Farhel-Express vous répondra prochainement.', demande });
});

// Suivre l'état d'une demande (par id + téléphone, pour éviter que n'importe qui la lise)
app.get('/api/demandes/:id', (req, res) => {
  const demande = db.get('demandes').find({ id: Number(req.params.id) }).value();
  if (!demande) return res.status(404).json({ error: 'Demande introuvable.' });
  const { telephone } = req.query;
  if (!telephone || telephone !== demande.telephone) {
    return res.status(403).json({ error: 'Numéro de téléphone incorrect pour cette demande.' });
  }
  res.json(demande);
});

// Envoyer un message (section "Écrivez-nous")
app.post('/api/messages', (req, res) => {
  const { nom, telephone, message } = req.body;
  if (!nom || !telephone || !message) {
    return res.status(400).json({ error: 'Nom, numéro et message sont obligatoires.' });
  }
  const conv = {
    id: nextId(),
    nom, telephone,
    echanges: [{ auteur: 'client', texte: message, date: new Date().toISOString() }],
    lu: false,
    dateCreation: new Date().toISOString()
  };
  db.get('messages').push(conv).write();
  res.status(201).json({ message: 'Votre message a bien été envoyé.', conversation: conv });
});

// Le client consulte sa conversation et voit les réponses de Farhel-Express
app.get('/api/messages/:id', (req, res) => {
  const conv = db.get('messages').find({ id: Number(req.params.id) }).value();
  if (!conv) return res.status(404).json({ error: 'Conversation introuvable.' });
  const { telephone } = req.query;
  if (!telephone || telephone !== conv.telephone) {
    return res.status(403).json({ error: 'Numéro de téléphone incorrect.' });
  }
  res.json(conv);
});

// Le client répond dans sa propre conversation
app.post('/api/messages/:id/repondre', (req, res) => {
  const conv = db.get('messages').find({ id: Number(req.params.id) }).value();
  if (!conv) return res.status(404).json({ error: 'Conversation introuvable.' });
  const { telephone, message } = req.body;
  if (telephone !== conv.telephone) return res.status(403).json({ error: 'Numéro de téléphone incorrect.' });
  if (!message) return res.status(400).json({ error: 'Message vide.' });
  db.get('messages').find({ id: conv.id }).get('echanges')
    .push({ auteur: 'client', texte: message, date: new Date().toISOString() }).write();
  db.get('messages').find({ id: conv.id }).assign({ lu: false }).write();
  res.json({ message: 'Message envoyé.' });
});

// ============================================================
// ROUTES ADMIN — Connexion + gestion
// ============================================================

app.post('/api/admin/login', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { identifiant, motDePasse } = req.body;
  const admin = db.get('admins').find({ identifiant }).value();
  if (!admin) return res.status(401).json({ error: 'Identifiants incorrects.' });
  const ok = await bcrypt.compare(motDePasse || '', admin.motDePasseHash);
  if (!ok) return res.status(401).json({ error: 'Identifiants incorrects.' });
  const token = jwt.sign({ identifiant }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

app.get('/api/admin/demandes', requireAdmin, (req, res) => {
  res.json(db.get('demandes').orderBy('dateCreation', 'desc').value());
});

app.put('/api/admin/demandes/:id/statut', requireAdmin, (req, res) => {
  const { statut } = req.body;
  const valides = ['En attente', 'En cours', 'Terminé', 'Annulé'];
  if (!valides.includes(statut)) return res.status(400).json({ error: 'Statut invalide.' });
  const found = db.get('demandes').find({ id: Number(req.params.id) });
  if (!found.value()) return res.status(404).json({ error: 'Demande introuvable.' });
  found.assign({ statut }).write();
  res.json({ message: 'Statut mis à jour.' });
});

app.delete('/api/admin/demandes/:id', requireAdmin, (req, res) => {
  db.get('demandes').remove({ id: Number(req.params.id) }).write();
  res.json({ message: 'Demande supprimée.' });
});

app.get('/api/admin/messages', requireAdmin, (req, res) => {
  res.json(db.get('messages').orderBy('dateCreation', 'desc').value());
});

app.post('/api/admin/messages/:id/repondre', requireAdmin, (req, res) => {
  const conv = db.get('messages').find({ id: Number(req.params.id) });
  if (!conv.value()) return res.status(404).json({ error: 'Conversation introuvable.' });
  const { texte } = req.body;
  if (!texte) return res.status(400).json({ error: 'Message vide.' });
  conv.get('echanges').push({ auteur: 'farhel', texte, date: new Date().toISOString() }).write();
  conv.assign({ lu: true }).write();
  res.json({ message: 'Réponse envoyée.' });
});

app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  db.get('messages').remove({ id: Number(req.params.id) }).write();
  res.json({ message: 'Conversation supprimée.' });
});

app.listen(PORT, () => {
  console.log(`Farhel-Express API démarrée sur le port ${PORT}`);
});
