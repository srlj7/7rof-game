const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

// Global State
let gameState = null;
let currentRoomId = localStorage.getItem('7rof_roomId');
let isHost = localStorage.getItem('7rof_isHost') === 'true';
let myPlayerId = localStorage.getItem('7rof_playerId');
let myTeam = localStorage.getItem('7rof_myTeam');

function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
        console.log("✅ Connected to server");
        reconnectAttempts = 0;
        
        // Auto-rejoin if we have active session
        if (currentRoomId && myPlayerId) {
            console.log("♻️ Attempting to rejoin room:", currentRoomId);
            ws.send(JSON.stringify({
                type: 'rejoin',
                roomId: currentRoomId,
                playerId: myPlayerId
            }));
        }
    };

    ws.onmessage = handleMessage;

    ws.onclose = (e) => {
        console.log("❌ Connection closed. Reconnecting...");
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
            setTimeout(connectWebSocket, delay);
        }
    };
}

// Start connection
connectWebSocket();

// Handle tab visibility (mobile backgrounding)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.log("👀 Visible again, checking connection...");
            connectWebSocket();
        }
    }
});


// Build hex grid - 5 cols x 5 rows = 25 cells, randomized letters
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 45; // r=45

// ===== DOM ELEMENTS =====
// Screens
const menuScreen = document.getElementById('menu-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');

// Menu UI
const btnShowCreate = document.getElementById('btn-show-create');
const btnShowJoin = document.getElementById('btn-show-join');
const menuOptions = document.getElementById('menu-options-container');
const createForm = document.getElementById('create-room-form');
const joinForm = document.getElementById('join-room-form');
const backBtns = document.querySelectorAll('.btn-back-menu');
const btnCategoryChange = document.id ? null : document.querySelectorAll('.btn-category-change'); // Handling multiple buttons

// Chat Elements
const btnChatToggle = document.getElementById('btn-chat-toggle');
const btnChatClose = document.getElementById('btn-chat-close');
const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const btnSendChat = document.getElementById('btn-send-chat');
const chatBadge = document.getElementById('chat-badge');

// Create Form
const createGameSuffix = document.getElementById('create-game-suffix');
const createHostName = document.getElementById('create-host-name');
const btnCreateRoom = document.getElementById('btn-create-room');

// Join Form
const joinRoomCode = document.getElementById('join-room-code');
const joinPlayerName = document.getElementById('join-player-name');
const btnJoinRoom = document.getElementById('btn-join-room');
const joinError = document.getElementById('join-error');

// Lobby Elements
const lobbyTitle = document.getElementById('lobby-title');
const lobbyRoomCode = document.getElementById('lobby-room-code');
const redPlayers = document.getElementById('red-players');
const bluePlayers = document.getElementById('blue-players');
const launchGameBtn = document.getElementById('launch-game-btn');
const backToMenuBtn = document.getElementById('back-to-menu');

// Game UI core
const hexGrid = document.getElementById('hex-grid');
const turnIndicator = document.getElementById('turn-indicator');
const gameTitleBar = document.getElementById('game-title-bar-text');
const redCount = document.getElementById('red-count');
const blueCount = document.getElementById('blue-count');
const redPower = document.getElementById('red-power');
const bluePower = document.getElementById('blue-power');

// Overlays
const questionOverlay = document.getElementById('question-overlay');
const winOverlay = document.getElementById('win-overlay');
const roundOverlay = document.getElementById('round-overlay');
const winText = document.getElementById('win-text');
const btnNewGame = document.getElementById('btn-new-game');
const confettiEl = document.getElementById('confetti');
const roundWinText = document.getElementById('round-win-text');

// Question Overlay Components
const timerSection = document.getElementById('timer-section');
const timerProgress = document.getElementById('timer-progress');
const timerNumber = document.getElementById('timer-number');
const buzzedInfo = document.getElementById('buzzed-info');
const buzzedName = document.getElementById('buzzed-name');
const buzzedTeamLabel = document.getElementById('buzzed-team-label');
const phaseLabel = document.getElementById('phase-label');
const receivedAnswerUI = document.getElementById('received-answer');
const answeringPlayerBadge = document.getElementById('answering-player-badge');
const judgingControls = document.getElementById('judging-controls');
const btnAwardRed = document.getElementById('btn-award-red');
const btnAwardBlue = document.getElementById('btn-award-blue');
const btnJudgeWrong = document.getElementById('btn-judge-wrong');

// Typing UI
const typingArea = document.getElementById('typing-area');
const answerInput = document.getElementById('answer-input');
const btnSubmitAnswer = document.getElementById('btn-submit-answer');

// Player Controls
const playerControls = document.getElementById('player-controls');
const btnBuzz = document.getElementById('btn-buzz');
const micStatus = document.getElementById('mic-status');
const recognizedTextUI = document.getElementById('recognized-text');

// Host Controls
const hostControls = document.querySelector('.host-controls');
const btnSkip = document.getElementById('btn-skip');
const btnCancel = document.getElementById('btn-cancel');

// Round elements
const roundTimerProgress = document.getElementById('round-timer-progress');
const roundTimerNumber = document.getElementById('round-timer-number');

// Initial setup
timerProgress.style.strokeDasharray = CIRCLE_CIRCUMFERENCE;
roundTimerProgress.style.strokeDasharray = CIRCLE_CIRCUMFERENCE;

// ===== HELPERS =====
function showScreen(screen) {
    [menuScreen, lobbyScreen, gameScreen].forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
}

function updateValidation(formType) {
    if (formType === 'create') {
        const hasTeam = document.querySelector('#create-room-form .team-btn.selected');
        const hasSuffix = document.getElementById('create-game-suffix').value.trim();
        const hasHost = document.getElementById('create-host-name').value.trim();
        btnCreateRoom.disabled = !(hasSuffix && hasHost && hasTeam);
        // Live update logo
        document.getElementById('logo-name-display').textContent = hasSuffix || '...';
    } else {
        const hasTeam = document.querySelector('#join-room-form .team-btn.selected');
        btnJoinRoom.disabled = !(joinRoomCode.value.trim() && joinPlayerName.value.trim() && hasTeam);
    }
}

// ===== MENU LISTENERS =====
btnShowCreate.addEventListener('click', () => {
    menuOptions.classList.add('hidden');
    createForm.classList.remove('hidden');
});

btnShowJoin.addEventListener('click', () => {
    menuOptions.classList.add('hidden');
    joinForm.classList.remove('hidden');
});

backBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        createForm.classList.add('hidden');
        joinForm.classList.add('hidden');
        menuOptions.classList.remove('hidden');
    });
});

document.querySelectorAll('.team-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const parent = e.target.closest('.team-selection');
        parent.querySelectorAll('.team-btn').forEach(b => b.classList.remove('selected'));
        e.target.classList.add('selected');
        updateValidation(parent.closest('#create-room-form') ? 'create' : 'join');
    });
});

[createGameSuffix, createHostName, joinRoomCode, joinPlayerName].forEach(input => {
    input.addEventListener('input', () => {
        updateValidation(input.closest('#create-room-form') ? 'create' : 'join');
    });
});

// ===== ROOM CREATION / JOINING =====
btnCreateRoom.addEventListener('click', () => {
    const nameSuffix = createGameSuffix.value.trim() || 'سيف';
    const hostName = createHostName.value.trim();
    const team = document.querySelector('#create-room-form .team-btn.selected').dataset.team;
    const redTeamName = document.getElementById('red-team-name').value.trim() || 'الفريق الأحمر';
    const blueTeamName = document.getElementById('blue-team-name').value.trim() || 'الفريق الأزرق';

    ws.send(JSON.stringify({
        type: 'create-room',
        nameSuffix,
        hostName,
        team,
        redTeamName,
        blueTeamName
    }));
});


btnJoinRoom.addEventListener('click', () => {
    const code = joinRoomCode.value.trim().toUpperCase();
    const playerName = joinPlayerName.value.trim();
    const team = document.querySelector('#join-room-form .team-btn.selected').dataset.team;

    joinError.classList.add('hidden');
    btnJoinRoom.disabled = true;

    ws.send(JSON.stringify({
        type: 'join-room',
        roomId: code,
        name: playerName,
        team: team
    }));
});

backToMenuBtn.addEventListener('click', () => {
    localStorage.clear();
    location.reload(); // Quick reset
});

// ===== VOICE RECOGNITION (Speech API) =====
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'ar-SA';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (gameState && gameState.phase === 'answering') {
            recognizedTextUI.textContent = `"${transcript}"`;
            recognizedTextUI.classList.remove('hidden');
            micStatus.classList.add('hidden');
            ws.send(JSON.stringify({ type: 'voice-answer', answer: transcript }));
        }
    };

    recognition.onerror = (event) => {
        console.error("Speech error", event.error);
        micStatus.classList.add('hidden');
        recognizedTextUI.textContent = '❌ لم يتم التقاط الصوت بوضوح';
        recognizedTextUI.classList.remove('hidden');

        // In case of error, send empty string so auto-judge fails it naturally
        setTimeout(() => {
            if (gameState && gameState.phase === 'answering') {
                ws.send(JSON.stringify({ type: 'voice-answer', answer: "" }));
            }
        }, 1500);
    };

    recognition.onend = () => {
        micStatus.classList.add('hidden');
    };
}

// Answer Submission
if (btnSubmitAnswer) {
    btnSubmitAnswer.addEventListener('click', () => {
        const answer = answerInput.value.trim();
        if (answer) {
            ws.send(JSON.stringify({ type: 'submit-answer', answer: answer }));
            typingArea.classList.add('hidden');
            answerInput.value = '';
        }
    });
}
if (answerInput) {
    answerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            btnSubmitAnswer.click();
        }
    });
}

// Host Judging Listeners
if (btnAwardRed) {
    btnAwardRed.addEventListener('click', () => {
        console.log("[Client] Clicking Award Red");
        ws.send(JSON.stringify({ type: 'award-point', team: 'red' }));
    });
}
if (btnAwardBlue) {
    btnAwardBlue.addEventListener('click', () => {
        console.log("[Client] Clicking Award Blue");
        ws.send(JSON.stringify({ type: 'award-point', team: 'blue' }));
    });
}
if (btnJudgeWrong) {
    btnJudgeWrong.addEventListener('click', () => {
        console.log("[Client] Clicking Judge Wrong");
        ws.send(JSON.stringify({ type: 'award-point', team: 'wrong' }));
    });
}

// --- Chat Logic ---
function toggleChat() {
    chatPanel.classList.toggle('hidden');
    if (!chatPanel.classList.contains('hidden')) {
        chatBadge.classList.add('hidden');
        chatInput.focus();
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

if (btnChatToggle) btnChatToggle.addEventListener('click', toggleChat);
if (btnChatClose) btnChatClose.addEventListener('click', toggleChat);

function sendChatMessage() {
    const text = chatInput.value.trim();
    if (text === '') return;
    
    ws.send(JSON.stringify({
        type: 'chat-message',
        text: text
    }));
    
    chatInput.value = '';
}

if (btnSendChat) btnSendChat.addEventListener('click', sendChatMessage);
if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
}

function addChatMessage(data) {
    const isMe = data.playerId === myPlayerId;
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isMe ? 'sent' : 'received'} ${data.team || ''}`;
    
    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';
    senderSpan.textContent = data.playerName + (data.isHost ? ' (المضيف)' : '');
    
    const textP = document.createElement('p');
    textP.textContent = data.text;
    
    msgDiv.appendChild(senderSpan);
    msgDiv.appendChild(textP);
    chatMessages.appendChild(msgDiv);
    
    // Auto scroll if panel is open
    if (!chatPanel.classList.contains('hidden')) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } else {
        // Show notification badge if closed
        chatBadge.classList.remove('hidden');
    }
}

// Timer constants
// ===== WEBSOCKET LISTENERS =====
function handleMessage(event) {
    const msg = JSON.parse(event.data);

    if (msg.type === 'error') {
        if (msg.code === 'SESSION_EXPIRED') {
            localStorage.clear(); // Clear bad session
            location.reload();
            return;
        }
        joinError.textContent = msg.message;
        joinError.classList.remove('hidden');
        btnJoinRoom.disabled = false;
        return;
    }

    // --- Consolidated Message Handling ---
    switch (msg.type) {
        case 'room-created':
        case 'joined-room':
            currentRoomId = msg.roomId;
            isHost = msg.role === 'host';
            myPlayerId = msg.id;
            myTeam = msg.team;
            gameState = msg.state;
            
            // Save session
            localStorage.setItem('7rof_roomId', msg.roomId);
            localStorage.setItem('7rof_isHost', isHost);
            localStorage.setItem('7rof_playerId', msg.id);
            localStorage.setItem('7rof_myTeam', msg.team);

            lobbyRoomCode.textContent = currentRoomId;
            if (isHost) {
                launchGameBtn.classList.remove('hidden');
                if (btnResetQuestions) btnResetQuestions.classList.remove('hidden');
            } else {
                launchGameBtn.classList.add('hidden');
            }
            showScreen(lobbyScreen);
            render();
            break;

        case 'game-state':
        case 'game-over':
        case 'round-won':
            gameState = msg.state;
            render();
            break;

        case 'chat-message':
            addChatMessage(msg);
            break;

        case 'new-round':
            gameState = msg.state;
            resetBuzzerUI();
            render();
            break;

        case 'player-left':
            if (gameState) {
                gameState.players = msg.players;
                renderPlayers();
            }
            break;

        case 'answer-received':
            if (gameState) {
                gameState.currentAnswer = msg.answer;
                gameState.autoResult = msg.isCorrect;
                gameState.phase = 'judging';
                render();
            }
            break;

        case 'game-name':
            gameState.gameName = msg.name;
            gameTitleBar.textContent = msg.name;
            lobbyTitle.textContent = msg.name.replace('حروف مع ', '');
            break;

        case 'buzzed':
            gameState.buzzedPlayer = msg.player;
            // The phase will update via game-state usually, but we can set it here for immediate feedback
            gameState.phase = 'speaking'; 
            showBuzzed(msg.player);
            break;

        case 'you-buzzed':
            // I successfully buzzed in!
            playerControls.classList.remove('hidden');
            btnBuzz.classList.add('hidden');
            micStatus.classList.remove('hidden'); // This now says "Speak now (others hear you)"
            typingArea.classList.add('hidden');
            break;

        case 'enable-buzzer':
            resetBuzzerUI();
            break;

        case 'game-state':
            updateGameState(msg.state);
            break;

        case 'chat-message':
            addChatMessage(msg);
            break;

        case 'timer':
            updateTimer(msg.seconds, msg.phase);
            break;

        case 'correct-answer':
            // Only host flashes correct
            break;

        case 'wrong-answer':
            phaseLabel.textContent = `❌ إجابة خاطئة: "${msg.spoken}"`;
            break;

        case 'team-chance': {
            const rN = (gameState && gameState.redTeamName) || 'الفريق الأحمر';
            const bN = (gameState && gameState.blueTeamName) || 'الفريق الأزرق';
            phaseLabel.textContent = `⏳ فرصة لـ ${msg.team === 'red' ? rN : bN}`;
            buzzedInfo.classList.add('hidden');
            if (recognition) { try { recognition.stop(); } catch (e) { } }
            break;
        }

        case 'open-round':
            phaseLabel.textContent = '🔓 الإجابة مفتوحة للجميع!';
            buzzedInfo.classList.add('hidden');
            timerSection.classList.add('hidden');
            if (recognition) { try { recognition.stop(); } catch (e) { } }
            break;

        case 'category-changed': {
            const rN2 = (gameState && gameState.redTeamName) || 'الفريق الأحمر';
            const bN2 = (gameState && gameState.blueTeamName) || 'الفريق الأزرق';
            phaseLabel.textContent = `⚡ ${msg.team === 'red' ? rN2 : bN2} غيّر الفئة إلى: ${msg.category}`;
            break;
        }
    }
}

function resetBuzzerUI() {
    if (!isHost || isHost) { // Everyone sees buzzer if they are playing
        playerControls.classList.remove('hidden');
        btnBuzz.classList.remove('hidden');
        btnBuzz.disabled = false;
        micStatus.classList.add('hidden');
        typingArea.classList.add('hidden');
        if (recognition) { try { recognition.stop(); } catch (e) { } }
    }
}

// ===== RENDER LOGIC =====
function render() {
    if (!gameState) return;
    const phase = gameState.phase;

    lobbyTitle.textContent = (gameState.gameName || "").replace('حروف مع ', '');

    if (phase === 'lobby') {
        renderPlayers();
        
        // Update lobby team names
        const lRed = document.getElementById('lobby-red-team-name');
        const lBlue = document.getElementById('lobby-blue-team-name');
        if (lRed) lRed.textContent = gameState.redTeamName || 'الفريق الأحمر';
        if (lBlue) lBlue.textContent = gameState.blueTeamName || 'الفريق الأزرق';

        return;
    } else {
        showScreen(gameScreen);
        gameTitleBar.textContent = gameState.gameName;
        renderGrid();
        renderScores();
        renderTurn();
        renderPowerUps();
    }

    // Update Round Scores
    document.getElementById('red-rounds').textContent = gameState.redRoundsWon || 0;
    document.getElementById('blue-rounds').textContent = gameState.blueRoundsWon || 0;

    // Phases
    questionOverlay.classList.add('hidden');
    winOverlay.classList.add('hidden');
    roundOverlay.classList.add('hidden');
    hexGrid.style.pointerEvents = isHost ? 'auto' : 'none'; // Only host can click cells

    if (phase === 'question' || phase === 'teamChance' || phase === 'openRound' || phase === 'answering' || phase === 'judging') {
        showQuestion();
    } else if (phase === 'round-won') {
        roundOverlay.classList.remove('hidden');
        hexGrid.style.pointerEvents = 'none';
        const roundWinnerTeam = gameState.roundWinner;
        const winnerName = roundWinnerTeam === 'red' ? 'الفريق الأحمر' : 'الفريق الأزرق';
        roundWinText.textContent = `فاز ${winnerName} بالجولة!`;
        roundWinText.style.color = roundWinnerTeam === 'red' ? 'var(--red-team)' : 'var(--blue-team)';
    } else if (phase === 'finished') {
        winOverlay.classList.remove('hidden');
        const wTeam = gameState.winner === 'red' ? 'الفريق الأحمر' : 'الفريق الأزرق';
        winText.textContent = `فاز ${wTeam}`;
        winText.style.color = gameState.winner === 'red' ? 'var(--red-team)' : 'var(--blue-team)';
        spawnConfetti();
    }
}

function renderPlayers() {
    if (!gameState || !gameState.players) return;
    
    const reds = gameState.players.filter(p => p.team === 'red');
    const blues = gameState.players.filter(p => p.team === 'blue');
    
    const containerRed = document.getElementById('red-players');
    const containerBlue = document.getElementById('blue-players');
    
    if (containerRed) {
        containerRed.innerHTML = reds.map(p => `<div class="player-tag">🔴 ${p.name} ${p.isHost ? '(مضيف)' : ''}</div>`).join('');
    }
    if (containerBlue) {
        containerBlue.innerHTML = blues.map(p => `<div class="player-tag">🔵 ${p.name} ${p.isHost ? '(مضيف)' : ''}</div>`).join('');
    }
    
    if (isHost && launchGameBtn) {
        launchGameBtn.disabled = gameState.players.length < 2;
    }
}

function renderGrid() {
    hexGrid.innerHTML = '';
    [0, 1, 2, 3, 4].forEach(r => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'hex-row' + (r % 2 === 1 ? ' offset' : '');
        gameState.cells.filter(c => c.row === r).forEach(cell => {
            const hex = document.createElement('div');
            hex.className = 'hex-cell';
            if (cell.owner === 'red') hex.classList.add('owned-red');
            if (cell.owner === 'blue') hex.classList.add('owned-blue');
            hex.innerHTML = `<span class="letter">${cell.letter}</span>`;
            if (!cell.owner && gameState.phase === 'playing' && isHost) {
                hex.addEventListener('click', () => selectCell(cell.index));
            }
            rowDiv.appendChild(hex);
        });
        hexGrid.appendChild(rowDiv);
    });
}

function renderScores() {
    redCount.textContent = gameState.cells.filter(c => c.owner === 'red').length;
    blueCount.textContent = gameState.cells.filter(c => c.owner === 'blue').length;
}

function renderTurn() {
    const t = gameState.currentTurn;
    const redName = gameState.redTeamName || 'الفريق الأحمر';
    const blueName = gameState.blueTeamName || 'الفريق الأزرق';

    // Update header team name labels
    const hRed = document.getElementById('header-red-team-name');
    const hBlue = document.getElementById('header-blue-team-name');
    if (hRed) hRed.textContent = redName + ' ↕';
    if (hBlue) hBlue.textContent = blueName + ' ↔';

    turnIndicator.className = 'turn-indicator ' + (t === 'red' ? 'turn-red' : 'turn-blue');
    turnIndicator.textContent = `دور ${t === 'red' ? redName + ' 🔴' : blueName + ' 🔵'}`;
}

function renderPowerUps() {
    redPower.classList.toggle('used', gameState.redCategoryChange);
    bluePower.classList.toggle('used', gameState.blueCategoryChange);
}

function showQuestion() {
    const q = gameState.currentQuestion;
    if (!q) return;
    questionOverlay.classList.remove('hidden');
    document.getElementById('q-category').textContent = q.category;
    document.getElementById('q-difficulty').textContent =
        q.difficulty === 'easy' ? '⭐ سهل' : q.difficulty === 'medium' ? '⭐⭐ متوسط' : '⭐⭐⭐ صعب';
    document.getElementById('q-letter').textContent = q.letter;
    document.getElementById('q-text').textContent = q.question;

    if (isHost) {
        btnSkip.classList.remove('hidden');
        btnCancel.classList.remove('hidden');
    } else {
        btnSkip.classList.add('hidden');
        btnCancel.classList.add('hidden');
    }

    if (gameState.phase === 'question' || gameState.phase === 'teamChance' || gameState.phase === 'openRound') {
        phaseLabel.textContent = 
            gameState.phase === 'question' ? '🔔 اضغطوا على الزر للإجابة!' :
            gameState.phase === 'teamChance' ? '🔄 فرصة للفريق الآخر!' : 
            '🌍 سؤال مفتوح للجميع!';
        
        buzzedInfo.classList.add('hidden');
        timerSection.classList.add('hidden');
        judgingControls.classList.add('hidden');
        receivedAnswerUI.classList.add('hidden');
        if (answeringPlayerBadge) answeringPlayerBadge.classList.add('hidden');
        
        // Ensure buzzer is visible and active for eligible players
        playerControls.classList.remove('hidden');
        btnBuzz.disabled = false;
        
        // Specific logic for teamChance: only other team can see buzzer
        if (gameState.phase === 'teamChance') {
            const teamChanceFor = gameState.answeringTeam === 'red' ? 'blue' : 'red';
            if (myTeam !== teamChanceFor) {
                playerControls.classList.add('hidden');
            }
        }
    } else if (gameState.phase === 'typing') {
        phaseLabel.textContent = '⌨️ اكتب الإجابة الآن!';
        buzzedInfo.classList.remove('hidden');
        timerSection.classList.remove('hidden');
        judgingControls.classList.add('hidden');
        receivedAnswerUI.classList.add('hidden');
        
        if (gameState.buzzedPlayer && gameState.buzzedPlayer.id === myPlayerId) {
            playerControls.classList.remove('hidden');
            micStatus.classList.add('hidden');
            typingArea.classList.remove('hidden');
            answerInput.focus();
        } else {
            playerControls.classList.add('hidden');
        }
    } else if (gameState.phase === 'judging') {
        phaseLabel.textContent = '⚖️ مراجعة الإجابة';
        buzzedInfo.classList.remove('hidden');
        timerSection.classList.add('hidden');
        
        receivedAnswerUI.textContent = `الإجابة المقروءة: ${gameState.currentAnswer || '...'}`;
        receivedAnswerUI.classList.remove('hidden');
        
        // Show player name badge
        if (answeringPlayerBadge && gameState.buzzedPlayer) {
            answeringPlayerBadge.textContent = `اللاعب: ${gameState.buzzedPlayer.name}`;
            answeringPlayerBadge.classList.remove('hidden');
        }

        if (isHost) {
            judgingControls.classList.remove('hidden');
            // Visual hint based on auto-judging
            if (btnAwardRed && btnAwardBlue && gameState.buzzedPlayer) {
                const suggTeam = gameState.buzzedPlayer.team;
                btnAwardRed.style.opacity = (gameState.autoResult && suggTeam === 'red') ? '1' : '0.8';
                btnAwardBlue.style.opacity = (gameState.autoResult && suggTeam === 'blue') ? '1' : '0.8';
            }
        } else {
            judgingControls.classList.add('hidden');
        }
    }
}

function showBuzzed(player) {
    buzzedInfo.classList.remove('hidden');
    buzzedName.textContent = player.name;
    buzzedName.style.color = player.team === 'red' ? 'var(--red-team)' : 'var(--blue-team)';
    buzzedTeamLabel.textContent = `الفريق ${player.team === 'red' ? 'الأحمر' : 'الأزرق'}`;
    timerSection.classList.remove('hidden');
    phaseLabel.textContent = '🗣️ انطق الإجابة (يسمعك الجميع)';

    // Disable buzzer for everyone
    btnBuzz.disabled = true;

    if (player.id !== myPlayerId) {
        playerControls.classList.add('hidden');
    }
}

function updateTimer(seconds, phase) {
    if (phase === 'speaking' || phase === 'typing' || phase === 'teamChance') {
        timerNumber.textContent = seconds;
        const total = phase === 'speaking' ? 5 : phase === 'typing' ? 20 : 10;
        const percent = (seconds / total) * 100;
        timerProgress.style.strokeDashoffset = CIRCLE_CIRCUMFERENCE - (percent / 100) * CIRCLE_CIRCUMFERENCE;
        timerProgress.classList.remove('warning', 'danger');
        if (seconds <= 2) timerProgress.classList.add('danger');
        else if (seconds <= 3) timerProgress.classList.add('warning');
    } else if (phase === 'round-won') {
        roundTimerNumber.textContent = seconds;
        const total = 5;
        const percent = (seconds / total) * 100;
        roundTimerProgress.style.strokeDashoffset = CIRCLE_CIRCUMFERENCE - (percent / 100) * CIRCLE_CIRCUMFERENCE;
    }
}

function spawnConfetti() {
    confettiEl.innerHTML = '';
    const colors = ['#ff4057', '#4090ff', '#ffd700', '#00e676', '#ff8800', '#b388ff'];
    for (let i = 0; i < 80; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = Math.random() * 2 + 's';
        piece.style.animationDuration = (2 + Math.random() * 2) + 's';
        confettiEl.appendChild(piece);
    }
}

// ===== ACTIONS =====
function selectCell(index) {
    ws.send(JSON.stringify({ type: 'select-cell', index }));
}

launchGameBtn.addEventListener('click', () => {
    ws.send(JSON.stringify({ type: 'start-game' }));
});

btnBuzz.addEventListener('click', () => {
    btnBuzz.disabled = true;
    ws.send(JSON.stringify({ type: 'buzz' }));
});

redPower.addEventListener('click', () => changeCategory('red'));
bluePower.addEventListener('click', () => changeCategory('blue'));

function changeCategory(team) {
    if (!isHost && myTeam !== team) return;
    if ((team === 'red' && gameState.redCategoryChange) || (team === 'blue' && gameState.blueCategoryChange)) return;
    if (gameState.phase !== 'question') return;

    fetch('/api/categories').then(r => r.json()).then(cats => {
        const currentCat = gameState.currentQuestion.category;
        const otherCats = cats.filter(c => c !== currentCat);
        if (otherCats.length > 0) {
            const randomNew = otherCats[Math.floor(Math.random() * otherCats.length)];
            ws.send(JSON.stringify({ type: 'category-change', category: randomNew }));
        }
    });
}

// Host controls
btnSkip.addEventListener('click', () => ws.send(JSON.stringify({ type: 'skip-question' })));
btnCancel.addEventListener('click', () => ws.send(JSON.stringify({ type: 'cancel-cell' })));
btnNewGame.addEventListener('click', () => {
    if (isHost) ws.send(JSON.stringify({ type: 'reset-game' }));
});

// ===== RESET USED QUESTIONS =====
const btnResetQuestions = document.getElementById('btn-reset-questions');
if (btnResetQuestions) {
    btnResetQuestions.addEventListener('click', () => {
        if (!isHost) return;
        if (!confirm('هل أنت متأكد من إعادة تعيين سجل الأسئلة المستخدمة؟\nستظهر جميع الأسئلة من جديد بما فيها الملعوبة مسبقاً.')) return;
        ws.send(JSON.stringify({ type: 'reset-used-questions' }));
    });
}

function showToast(msg, color = '#00e676') {
    const toast = document.getElementById('toast-msg');
    if (!toast) return;
    toast.textContent = msg;
    toast.style.background = color;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
}

// Hex Bg Graphics
function generateHexBg(container) {
    if (!container) return;
    const letters = 'ا ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن هـ و ي'.split(' ');
    const w = window.innerWidth; const h = window.innerHeight;
    const cellW = 90; const cellH = 100;
    const cols = Math.ceil(w / (cellW * 0.85)) + 1;
    const rows = Math.ceil(h / (cellH * 0.75)) + 1;
    container.innerHTML = '';
    let li = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const div = document.createElement('div');
            div.className = 'hex-bg-cell';
            const x = c * (cellW * 0.85) + (r % 2 === 1 ? cellW * 0.42 : 0);
            const y = r * (cellH * 0.75);
            div.style.left = x + 'px';
            div.style.top = y + 'px';
            div.textContent = letters[li % letters.length];
            li++;
            container.appendChild(div);
        }
    }
}
generateHexBg(document.getElementById('hex-bg-pattern'));
generateHexBg(document.getElementById('hex-bg-lobby'));
generateHexBg(document.getElementById('hex-bg-game'));
window.addEventListener('resize', () => {
    generateHexBg(document.getElementById('hex-bg-pattern'));
    generateHexBg(document.getElementById('hex-bg-lobby'));
    generateHexBg(document.getElementById('hex-bg-game'));
});
