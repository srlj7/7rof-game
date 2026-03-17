const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const os = require('os');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Load questions
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));

// ===== GLOBAL QUESTION HISTORY (Persists across sessions) =====
const USED_QUESTIONS_FILE = path.join(__dirname, 'used_questions.json');

function loadGlobalUsed() {
  try {
    if (fs.existsSync(USED_QUESTIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USED_QUESTIONS_FILE, 'utf8'));
      return new Set(data);
    }
  } catch (e) { console.error('Could not load used_questions.json:', e.message); }
  return new Set();
}

function saveGlobalUsed() {
  try {
    fs.writeFileSync(USED_QUESTIONS_FILE, JSON.stringify([...globalUsedQuestions]));
  } catch (e) { console.error('Could not save used_questions.json:', e.message); }
}

function resetGlobalUsed() {
  globalUsedQuestions.clear();
  saveGlobalUsed();
  console.log('♻️  Global question history reset.');
}

let globalUsedQuestions = loadGlobalUsed();
console.log(`📊 Loaded ${globalUsedQuestions.size} previously used questions from history.`);

// Get local IP - prefer Wi-Fi over virtual adapters
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  let fallback = null;
  // Priority: Wi-Fi > Ethernet > any other
  const priority = ['Wi-Fi', 'WiFi', 'Wireless', 'WLAN', 'Ethernet', 'eth0', 'en0'];
  for (const pName of priority) {
    for (const name of Object.keys(interfaces)) {
      if (name.toLowerCase().includes(pName.toLowerCase())) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254')) {
            return iface.address;
          }
        }
      }
    }
  }
  // Fallback: any non-internal, non-169, non-172.16 address
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal &&
        !iface.address.startsWith('169.254') && !iface.address.startsWith('172.')) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
const LOCAL_IP = getLocalIP();

// ===== GAME STATE & ROOMS =====
const ARABIC_LETTERS = ['ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي'];

const rooms = new Map(); // roomId -> roomState

// Build hex grid - 5 cols x 5 rows = 25 cells, randomized letters

// Build hex grid - 5 cols x 5 rows = 25 cells, randomized letters
function initGrid() {
  const cells = [];
  const shuffledLetters = [...ARABIC_LETTERS];
  // Fisher-Yates shuffle
  for (let i = shuffledLetters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledLetters[i], shuffledLetters[j]] = [shuffledLetters[j], shuffledLetters[i]];
  }

  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      if (idx < 25) {
        cells.push({ letter: shuffledLetters[idx], owner: null, row, col, index: idx });
        idx++;
      }
    }
  }
  return cells;
}

// ===== DIFFICULTY SCALING =====
function getDifficulty(room) {
  const filled = room.cells.filter(c => c.owner !== null).length;
  const ratio = filled / 25;
  if (ratio < 0.4) return ['easy', 'medium'];
  if (ratio < 0.7) return ['medium'];
  return ['hard'];
}

function isCriticalCell(room, cellIndex) {
  // Check if this cell could complete or block a winning path
  const cell = room.cells[cellIndex];
  for (const team of ['red', 'blue']) {
    const tempCells = room.cells.map(c => ({ ...c }));
    tempCells[cellIndex].owner = team;
    if (checkWinFor(tempCells, team)) return true;
  }
  return false;
}

// ===== WIN DETECTION =====
function checkWinFor(cells, team) {
  // Red: top to bottom (row 0 to row 3)
  // Blue: left to right (col 0 to col 6)
  const owned = cells.filter(c => c.owner === team);
  if (owned.length === 0) return false;

  const startCells = team === 'red'
    ? owned.filter(c => c.row === 0)
    : owned.filter(c => c.col === 0);

  const targetCheck = team === 'red'
    ? (c) => c.row === 4
    : (c) => c.col === 4;

  const visited = new Set();
  const queue = [...startCells];

  while (queue.length > 0) {
    const current = queue.shift();
    const key = `${current.row},${current.col}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (targetCheck(current)) return true;

    // Hex neighbors
    const neighbors = getHexNeighbors(current.row, current.col);
    for (const [nr, nc] of neighbors) {
      const neighbor = cells.find(c => c.row === nr && c.col === nc && c.owner === team);
      if (neighbor && !visited.has(`${nr},${nc}`)) {
        queue.push(neighbor);
      }
    }
  }
  return false;
}

function getHexNeighbors(row, col) {
  const isOddRow = row % 2 === 1;
  if (isOddRow) {
    return [[row - 1, col], [row - 1, col + 1], [row, col - 1], [row, col + 1], [row + 1, col], [row + 1, col + 1]];
  } else {
    return [[row - 1, col - 1], [row - 1, col], [row, col - 1], [row, col + 1], [row + 1, col - 1], [row + 1, col]];
  }
}

function checkWin(room) {
  if (checkWinFor(room.cells, 'red')) return 'red';
  if (checkWinFor(room.cells, 'blue')) return 'blue';
  return null;
}

// ===== QUESTION SELECTION =====
function getQuestion(room, letter, forcedCategory = null) {
  const difficulties = isCriticalCell(room, room.selectedCell) ? ['hard'] : getDifficulty(room);

  // Exclude globally used questions FIRST (cross-session track)
  let pool = questions.filter(q =>
    q.letter === letter &&
    difficulties.includes(q.difficulty) &&
    !globalUsedQuestions.has(q.id) &&
    !room.usedQuestions.has(q.id)
  );

  if (forcedCategory) {
    const catPool = pool.filter(q => q.category === forcedCategory);
    if (catPool.length > 0) pool = catPool;
  }

  // Fallback 1: ignore difficulty, still respect global history
  if (pool.length === 0) {
    pool = questions.filter(q =>
      q.letter === letter &&
      !globalUsedQuestions.has(q.id) &&
      !room.usedQuestions.has(q.id)
    );
  }

  // Fallback 2: all questions for this letter used globally — reset global for this letter only
  if (pool.length === 0) {
    console.log(`⚠️  All questions for «${letter}» have been used globally. Resetting history for this letter.`);
    // Remove only this letter's questions from global set
    for (const id of [...globalUsedQuestions]) {
      const q = questions.find(q => q.id === id);
      if (q && q.letter === letter) globalUsedQuestions.delete(id);
    }
    saveGlobalUsed();
    pool = questions.filter(q => q.letter === letter && !room.usedQuestions.has(q.id));
  }

  // Final fallback: clear room-local set too
  if (pool.length === 0) {
    pool = questions.filter(q => q.letter === letter);
    room.usedQuestions.clear();
  }

  const q = pool[Math.floor(Math.random() * pool.length)];
  room.usedQuestions.add(q.id);
  globalUsedQuestions.add(q.id);
  saveGlobalUsed();
  return q;
}

// ===== ANSWER MATCHING =====
function normalizeArabic(text) {
  return text
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .replace(/[^\u0600-\u06FF\s]/g, '')
    .trim();
}

function checkAnswer(spoken, correct) {
  const s = normalizeArabic(spoken);
  const c = normalizeArabic(correct);
  if (s === c) return true;
  if (s.includes(c) || c.includes(s)) return true;
  // Levenshtein-like similarity
  const longer = s.length > c.length ? s : c;
  const shorter = s.length > c.length ? c : s;
  if (longer.length === 0) return false;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return (matches / longer.length) > 0.7;
}

// ===== TIMERS & BROADCAST =====
function clearGameTimer(room) {
  if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
}

function startTimer(roomId, room, seconds, onEnd) {
  clearGameTimer(room);
  room.timerSeconds = seconds;
  broadcastToRoom(roomId, { type: 'timer', seconds, phase: room.phase });
  room.timerInterval = setInterval(() => {
    room.timerSeconds--;
    broadcastToRoom(roomId, { type: 'timer', seconds: room.timerSeconds, phase: room.phase });
    if (room.timerSeconds <= 0) {
      clearGameTimer(room);
      onEnd();
    }
  }, 1000);
}

function createRoomState(name = 'حروف مع سيف', redTeamName = 'الفريق الأحمر', blueTeamName = 'الفريق الأزرق') {
  return {
    phase: 'lobby',
    gameName: name,
    redTeamName,
    blueTeamName,
    cells: initGrid(),
    currentTurn: 'red',
    selectedCell: null,
    currentQuestion: null,
    buzzedPlayer: null,
    buzzLocked: false,
    timerSeconds: 0,
    timerInterval: null,
    players: [],
    redCategoryChange: false,
    blueCategoryChange: false,
    usedQuestions: new Set(),
    winner: null,
    answeringTeam: null,
    redRoundsWon: 0,
    blueRoundsWon: 0,
    round: 1,
    currentAnswer: null,
    autoResult: null
  };
}

function getPublicGameState(room) {
  return {
    phase: room.phase,
    gameName: room.gameName,
    redTeamName: room.redTeamName,
    blueTeamName: room.blueTeamName,
    cells: room.cells,
    currentTurn: room.currentTurn,
    selectedCell: room.selectedCell,
    currentQuestion: room.currentQuestion ? {
      question: room.currentQuestion.question,
      category: room.currentQuestion.category,
      letter: room.currentQuestion.letter,
      difficulty: room.currentQuestion.difficulty
    } : null,
    buzzedPlayer: room.buzzedPlayer,
    timerSeconds: room.timerSeconds,
    players: room.players,
    redCategoryChange: room.redCategoryChange,
    blueCategoryChange: room.blueCategoryChange,
    currentAnswer: room.currentAnswer,
    autoResult: room.autoResult,
    redRoundsWon: room.redRoundsWon,
    blueRoundsWon: room.blueRoundsWon,
    roundWinner: room.roundWinner
  };
}

// ===== WEBSOCKET =====
const clients = new Map(); // ws -> { roomId, type: 'host' | 'player', id, name, team }
const sessions = new Map(); // clientId -> { roomId, type, id, name, team, isHost, ws, timeout }

function broadcastToRoom(roomId, msg) {
  const data = JSON.stringify(msg);
  for (const [ws, info] of clients) {
    if (ws.readyState === 1 && info.roomId === roomId) ws.send(data);
  }
}


// WEBSOCKET SERVER

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const clientId = uuidv4();
  clients.set(ws, { roomId: null, type: 'unknown', id: clientId });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    
    // --- Session / Reconnection Handling ---
    if (msg.type === 'rejoin') {
      const { roomId, playerId } = msg;
      const session = sessions.get(playerId);
      
      if (session && session.roomId === roomId) {
        // Clear expiry timeout
        if (session.timeout) {
          clearTimeout(session.timeout);
          session.timeout = null;
        }
        
        // Update session with new socket
        session.ws = ws;
        clients.set(ws, { 
          roomId: session.roomId, 
          type: session.type, 
          id: session.id, 
          name: session.name, 
          team: session.team,
          isHost: session.isHost
        });
        
        const room = rooms.get(roomId);
        if (room) {
          // If the player was marked as inactive/removed, re-add them if missing
          if (!room.players.find(p => p.id === playerId)) {
            room.players.push({ id: session.id, name: session.name, team: session.team, isHost: session.isHost });
          }
          
          ws.send(JSON.stringify({ 
            type: 'joined-room', 
            roomId, 
            role: session.type, 
            id: session.id, 
            team: session.team,
            rejoined: true
          }));
          ws.send(JSON.stringify({ type: 'game-state', state: getPublicGameState(room) }));
          broadcastToRoom(roomId, { type: 'player-joined', player: { id: session.id, name: session.name, team: session.team }, players: room.players });
        }
        return;
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'الجلسة منتهية، يرجى الانضمام مجدداً', code: 'SESSION_EXPIRED' }));
        return;
      }
    }

    const client = clients.get(ws);

    // --- Room Management ---
    if (msg.type === 'create-room') {
      const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
      const suffix = msg.nameSuffix || 'سيف';
      const fullName = 'حروف مع ' + suffix;
      const redTeamName = msg.redTeamName || 'الفريق الأحمر';
      const blueTeamName = msg.blueTeamName || 'الفريق الأزرق';
      rooms.set(roomId, createRoomState(fullName, redTeamName, blueTeamName));
      client.roomId = roomId;
      client.type = 'host';
      client.name = msg.hostName;
      client.team = msg.team; // Host chooses a team
      client.isHost = true;

      const room = rooms.get(roomId);
      room.players.push({ id: clientId, name: msg.hostName, team: msg.team, isHost: true });

      // Save session
      sessions.set(clientId, { 
        roomId, type: 'host', id: clientId, name: msg.hostName, 
        team: msg.team, isHost: true, ws 
      });

      ws.send(JSON.stringify({ 
        type: 'room-created', 
        roomId, 
        role: 'host', 
        id: clientId, 
        team: msg.team,
        state: getPublicGameState(room)
      }));
      ws.send(JSON.stringify({ type: 'game-state', state: getPublicGameState(room) }));
      return;
    }

    if (msg.type === 'join-room') {
      const roomId = msg.roomId.toUpperCase();
      const room = rooms.get(roomId);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: 'الغرفة غير موجودة' }));
        return;
      }
      if (room.phase !== 'lobby') {
        ws.send(JSON.stringify({ type: 'error', message: 'المباراة بدأت بالفعل' }));
        return;
      }

      client.roomId = roomId;
      client.type = 'player';
      client.name = msg.name;
      client.team = msg.team;
      client.isHost = false;

      room.players.push({ id: clientId, name: msg.name, team: msg.team, isHost: false });
      
      // Save session
      sessions.set(clientId, { 
        roomId, type: 'player', id: clientId, name: msg.name, 
        team: msg.team, isHost: false, ws 
      });

      ws.send(JSON.stringify({ 
        type: 'joined-room', 
        roomId, 
        role: 'player', 
        id: clientId, 
        team: msg.team,
        state: getPublicGameState(room)
      }));
      // Broadcast full state to everyone instead of just 'player-joined'
      broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(room) });
      return;
    }

    // --- Game Logic (Requires Room) ---
    const roomId = client.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    switch (msg.type) {
      case 'set-game-name':
        if (!client.isHost) break;
        room.gameName = msg.name;
        broadcastToRoom(roomId, { type: 'game-name', name: msg.name });
        break;

      case 'start-game':
        if (!client.isHost) break;
        room.phase = 'playing';
        broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(room) });
        break;

      case 'select-cell':
        if (!client.isHost || room.phase !== 'playing') break;
        const cell = room.cells[msg.index];
        if (!cell || cell.owner !== null) break;
        room.selectedCell = msg.index;
        const q = getQuestion(room, cell.letter);
        room.currentQuestion = q;
        room.phase = 'question';
        room.buzzLocked = false;
        room.buzzedPlayer = null;
        room.answeringTeam = null;
        room._hadTeamChance = false;
        room.currentAnswer = null; // Reset for new question
        room.autoResult = null;     // Reset for new question
        broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(room) });
        broadcastToRoom(roomId, { type: 'enable-buzzer' });
        break;

      case 'buzz':
        if (room.buzzLocked) break;
        if (room.phase !== 'question' && room.phase !== 'teamChance' && room.phase !== 'openRound') break;
        // In teamChance, only other team can buzz
        if (room.phase === 'teamChance' && client.team === room.answeringTeam) break;
        room.buzzLocked = true;
        room.buzzedPlayer = { id: clientId, name: client.name, team: client.team };
        room.answeringTeam = client.team;
        room.phase = 'answering';
        broadcastToRoom(roomId, { type: 'buzzed', player: room.buzzedPlayer });
        ws.send(JSON.stringify({ type: 'you-buzzed' }));
        // Start 5s timer for answer
        startTimer(roomId, room, 5, () => {
          // Time's up, wrong answer default
          handleWrongAnswer(roomId, room);
        });
        break;

      case 'voice-answer':
        if (room.phase !== 'answering') break;
        if (client.id !== room.buzzedPlayer?.id) break;
        clearGameTimer(room);

        // Transition to judging phase
        room.phase = 'judging';
        room.currentAnswer = msg.answer;
        // Game automatically checks, but host confirms/overrides
        const isCorrect = checkAnswer(msg.answer, room.currentQuestion.answer);
        room.autoResult = isCorrect;

        broadcastToRoom(roomId, { 
            type: 'answer-received', 
            answer: msg.answer, 
            isCorrect: isCorrect,
            player: room.buzzedPlayer 
        });
        broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(room) });
        break;

      case 'judge-answer':
        // Old handler, keeping it for compatibility or removing it if safe
        break;

      case 'award-point':
        console.log(`[Judgement] Received award-point from ${client.name}. Team: ${msg.team}. Phase: ${room.phase}. IsHost: ${client.isHost}`);
        if (!client.isHost) {
          console.warn("[Judgement] Rejected: Client is not host");
          break;
        }
        if (room.phase !== 'judging') {
          console.warn(`[Judgement] Rejected: Wrong phase (${room.phase})`);
          break;
        }

        if (msg.team === 'red' || msg.team === 'blue') {
          console.log(`[Judgement] Awarding point to ${msg.team}`);
          handleCorrectAnswer(roomId, room, msg.team);
        } else if (msg.team === 'wrong') {
          console.log("[Judgement] Marking as wrong answer");
          broadcastToRoom(roomId, { type: 'wrong-answer', player: room.buzzedPlayer, spoken: room.currentAnswer });
          handleWrongAnswer(roomId, room);
        }
        break;

      case 'skip-question':
        if (!client.isHost) break;
        clearGameTimer(room);
        const newQ = getQuestion(room, room.cells[room.selectedCell].letter);
        room.currentQuestion = newQ;
        room.phase = 'question';
        room.buzzLocked = false;
        room.buzzedPlayer = null;
        room.answeringTeam = null;
        broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(room) });
        broadcastToRoom(roomId, { type: 'enable-buzzer' });
        break;

      case 'category-change':
        const team = client.team;
        if (!team) break;
        if ((team === 'red' && room.redCategoryChange) || (team === 'blue' && room.blueCategoryChange)) break;
        if (team === 'red') room.redCategoryChange = true;
        else room.blueCategoryChange = true;
        const catQ = getQuestion(room, room.cells[room.selectedCell].letter, msg.category);
        room.currentQuestion = catQ;
        room.phase = 'question';
        room.buzzLocked = false;
        room.buzzedPlayer = null;
        room.answeringTeam = null;
        broadcastToRoom(roomId, { type: 'category-changed', team, category: msg.category });
        broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(room) });
        broadcastToRoom(roomId, { type: 'enable-buzzer' });
        break;

      case 'cancel-cell':
        if (!client.isHost) break;
        clearGameTimer(room);
        room.phase = 'playing';
        room.selectedCell = null;
        room.currentQuestion = null;
        room.buzzedPlayer = null;
        room.buzzLocked = false;
        room.answeringTeam = null;
        broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(room) });
        break;

      case 'reset-game':
        if (!client.isHost) break;
        clearGameTimer(room);
        const prevPlayers = room.players;
        const prevName = room.gameName;
        const newRoomState = createRoomState(prevName);
        newRoomState.players = prevPlayers;
        rooms.set(roomId, newRoomState);
        broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(newRoomState) });
        break;

      case 'reset-used-questions':
        if (!client.isHost) break;
        resetGlobalUsed();
        ws.send(JSON.stringify({ type: 'questions-reset', count: questions.length }));
        break;

      case 'chat-message':
        broadcastToRoom(roomId, {
          type: 'chat-message',
          text: msg.text,
          playerId: client.id,
          playerName: client.name,
          team: client.team,
          isHost: client.isHost || false
        });
        break;

    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket Error:', err);
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client && client.roomId) {
      const session = sessions.get(client.id);
      if (session) {
        // Don't remove immediately. Set a grace period of 2 minutes.
        console.log(`🔌 Player ${client.name} disconnected. Waiting 2m for rejoin...`);
        
        session.timeout = setTimeout(() => {
          console.log(`⏰ Session expired for ${client.name}. Removing from room ${client.roomId}.`);
          const room = rooms.get(client.roomId);
          if (room) {
            room.players = room.players.filter(p => p.id !== client.id);
            // Broadcast state to everyone
            broadcastToRoom(client.roomId, { type: 'game-state', state: getPublicGameState(room) });
            if (client.isHost && room.players.length === 0) {
              rooms.delete(client.roomId);
            }
          }
          sessions.delete(client.id);
        }, 120000); // 2 minutes
      }
    }
    clients.delete(ws);
  });
});

// Heartbeat interval to keep connections alive (every 30s)
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

function handleCorrectAnswer(roomId, room, teamOverride = null) {
  const team = teamOverride || room.buzzedPlayer.team;
  room.cells[room.selectedCell].owner = team;
  broadcastToRoom(roomId, { type: 'correct-answer', player: room.buzzedPlayer, answer: room.currentQuestion.answer, cellIndex: room.selectedCell });

  const roundWinner = checkWin(room);
  if (roundWinner) {
    if (roundWinner === 'red') room.redRoundsWon++;
    if (roundWinner === 'blue') room.blueRoundsWon++;

    if (room.redRoundsWon >= 2 || room.blueRoundsWon >= 2) {
      // Match Over
      room.phase = 'finished';
      room.winner = roundWinner;
      broadcastToRoom(roomId, { type: 'game-over', winner: roundWinner, state: getPublicGameState(room) });
    } else {
      // Round Over, but Match continues
      room.phase = 'round-won';

      const stateToBroadcast = getPublicGameState(room);
      stateToBroadcast.roundWinner = roundWinner;

      broadcastToRoom(roomId, { type: 'round-won', winner: roundWinner, state: stateToBroadcast });

      // Start 5 second timer before next round
      let count = 5;
      broadcastToRoom(roomId, { type: 'timer', seconds: count, phase: 'round-won' });
      room.timerInterval = setInterval(() => {
        count--;
        broadcastToRoom(roomId, { type: 'timer', seconds: count, phase: 'round-won' });
        if (count <= 0) {
          clearInterval(room.timerInterval);
          room.round++;
          room.cells = initGrid(); // Reshuffles letters
          room.currentTurn = 'red';
          room.selectedCell = null;
          room.currentQuestion = null;
          room.buzzedPlayer = null;
          room.buzzLocked = false;
          room.answeringTeam = null;
          room.phase = 'playing';
          broadcastToRoom(roomId, { type: 'new-round', state: getPublicGameState(room) });
        }
      }, 1000);
    }
  } else {
    room.currentTurn = room.currentTurn === 'red' ? 'blue' : 'red';
    room.phase = 'playing';
    room.selectedCell = null;
    room.currentQuestion = null;
    room.buzzedPlayer = null;
    room.buzzLocked = false;
    room.answeringTeam = null;
    broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(room) });
  }
}

function handleWrongAnswer(roomId, room) {
  const previousPhase = room.phase;
  const wrongTeam = room.buzzedPlayer?.team;

  if ((previousPhase === 'answering' || previousPhase === 'judging') && !room._hadTeamChance) {
    // First wrong: give other team 10 seconds
    room.phase = 'teamChance';
    room._hadTeamChance = true;
    room.buzzLocked = false;
    room.buzzedPlayer = null;
    broadcastToRoom(roomId, { type: 'team-chance', team: wrongTeam === 'red' ? 'blue' : 'red' });
    broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(room) });
    broadcastToRoom(roomId, { type: 'enable-buzzer' });
    startTimer(roomId, room, 10, () => {
      // No one from other team answered — open round
      room.phase = 'openRound';
      room.buzzLocked = false;
      room.buzzedPlayer = null;
      room.answeringTeam = null;
      broadcastToRoom(roomId, { type: 'open-round' });
      broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(room) });
      broadcastToRoom(roomId, { type: 'enable-buzzer' });
    });
  } else if ((previousPhase === 'answering' || previousPhase === 'judging') && room._hadTeamChance) {
    // Second wrong (from team chance) — open round
    room.phase = 'openRound';
    room.buzzLocked = false;
    room.buzzedPlayer = null;
    room.answeringTeam = null;
    broadcastToRoom(roomId, { type: 'open-round' });
    broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(room) });
    broadcastToRoom(roomId, { type: 'enable-buzzer' });
  } else {
    // Open round wrong — just re-enable buzzer
    room.buzzLocked = false;
    room.buzzedPlayer = null;
    broadcastToRoom(roomId, { type: 'game-state', state: getPublicGameState(room) });
    broadcastToRoom(roomId, { type: 'enable-buzzer' });
  }
}

// QR Code endpoint
app.get('/qr', async (req, res) => {
  // Use the host from the request (works for both local and public URLs)
  const host = req.headers.host || `${LOCAL_IP}:${PORT}`;
  const protocol = req.protocol;
  const url = `${protocol}://${host}/player.html`;
  
  const qr = await QRCode.toDataURL(url, { width: 400, margin: 2 });
  res.json({ qr, url });
});

app.get('/api/categories', (req, res) => {
  const cats = [...new Set(questions.map(q => q.category))];
  res.json(cats);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎮 حروف مع سيف - Game Server`);
  console.log(`📺 Host Display: http://localhost:${PORT}`);
  console.log(`📱 Player URL: http://${LOCAL_IP}:${PORT}/player.html`);
  console.log(`\nAll devices must be on the same WiFi network!\n`);
});
