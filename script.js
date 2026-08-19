const statusElem = document.getElementById('status');
const joinSection = document.getElementById('join-section');
const callSection = document.getElementById('call-section');
const currentRoomInfo = document.getElementById('current-room-info');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const availableRoomsElem = document.getElementById('available-rooms');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

let localStream = null;
let peer = null;
let currentCall = null;
let currentRoom = null;
let isHost = false;

// STUN серверы
const peerConfig = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};

// 1. Максимально стабильная инициализация камеры
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    localVideo.muted = true;
    localVideo.srcObject = localStream;
    
    // Безопасный запуск воспроизведения для Safari
    try {
      await localVideo.play();
    } catch (e) {
      console.warn('Autoplay warning:', e);
    }

    statusElem.textContent = 'Камера готова. Введите название комнаты или выберите из списка.';
    
    // Запуск механизма комнат только ПОСЛЕ успешного включения камеры
    initRoomDiscovery();

    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      roomInput.value = roomParam;
      joinRoom(roomParam);
    }
  } catch (err) {
    statusElem.style.color = '#ef4444';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      statusElem.textContent = 'Доступ к камере/микрофону запрещен в настройках браузера. Разрешите доступ и обновите страницу.';
    } else {
      statusElem.textContent = `Ошибка доступа к камере: ${err.name} (${err.message})`;
    }
  }
}

// 2. Трекинг свободных комнат через нативный BroadcastChannel и localStorage
function initRoomDiscovery() {
  updateRoomsDisplay();

  // Синхронизация между вкладками / окнами в реальном времени
  try {
    const channel = new BroadcastChannel('p2p_rooms_channel');
    channel.onmessage = (event) => {
      if (event.data && event.data.type === 'update') {
        updateRoomsDisplay();
      }
    };
  } catch (e) {
    console.warn('BroadcastChannel not supported', e);
  }

  // Очистка устаревших комнат каждые 3 секунды
  setInterval(updateRoomsDisplay, 3000);
}

function registerRoom(roomName) {
  try {
    const rooms = getStoredRooms();
    rooms[roomName] = Date.now();
    localStorage.setItem('p2p_active_rooms', JSON.stringify(rooms));
    notifyRoomUpdate();
    updateRoomsDisplay();
  } catch (e) {}
}

function unregisterRoom(roomName) {
  try {
    const rooms = getStoredRooms();
    delete rooms[roomName];
    localStorage.setItem('p2p_active_rooms', JSON.stringify(rooms));
    notifyRoomUpdate();
    updateRoomsDisplay();
  } catch (e) {}
}

function getStoredRooms() {
  try {
    const data = localStorage.getItem('p2p_active_rooms');
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
}

function notifyRoomUpdate() {
  try {
    const channel = new BroadcastChannel('p2p_rooms_channel');
    channel.postMessage({ type: 'update' });
  } catch (e) {}
}

function updateRoomsDisplay() {
  const roomsObj = getStoredRooms();
  const now = Date.now();
  const activeRooms = [];

  // Фильтруем комнаты, активные за последние 15 секунд
  for (const [name, time] of Object.entries(roomsObj)) {
    if (now - time < 15000 && name !== currentRoom) {
      activeRooms.push(name);
    }
  }

  renderRoomsList(activeRooms);
}

function renderRoomsList(rooms) {
  availableRoomsElem.innerHTML = '';
  if (rooms.length === 0) {
    availableRoomsElem.innerHTML = '<span style="color: #666; font-size: 13px;">Свободных комнат нет. Создайте первую!</span>';
    return;
  }

  rooms.forEach(room => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `<span class="status-dot"></span>${room} (ждёт 1)`;
    tag.onclick = () => {
      roomInput.value = room;
      joinRoom(room);
    };
    availableRoomsElem.appendChild(tag);
  });
}

// 3. Подключение и звонки
function joinRoom(rawRoomName) {
  const room = rawRoomName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!room) {
    alert('Пожалуйста, используйте буквы и цифры');
    return;
  }

  currentRoom = room;
  window.history.pushState({}, '', `?room=${room}`);

  joinSection.style.display = 'none';
  callSection.style.display = 'block';
  currentRoomInfo.textContent = `Текущая комната: ${room}`;

  if (peer) peer.destroy();

  const hostId = `p2p-call-${room}-host`;
  peer = new Peer(hostId, peerConfig);

  peer.on('open', () => {
    isHost = true;
    statusElem.textContent = `Вы создали комнату «${room}». Ссылка скопирована! Ждем собеседника...`;
    navigator.clipboard?.writeText(window.location.href).catch(() => {});

    // Регистрируем комнату как ожидающую
    registerRoom(room);
  });

  peer.on('call', (call) => {
    // Подключился гость -> комната заполнена
    unregisterRoom(room);
    statusElem.textContent = 'Собеседник подключился. Звонок активен.';
    call.answer(localStream);
    handleStream(call);
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      connectAsGuest(room, hostId);
    } else {
      statusElem.textContent = 'Ошибка: ' + err.message;
    }
  });
}

function connectAsGuest(room, hostId) {
  isHost = false;
  statusElem.textContent = `Подключение к владельцу комнаты «${room}»...`;
  
  // Убираем комнату из свободных
  unregisterRoom(room);

  peer = new Peer(peerConfig);

  peer.on('open', () => {
    const call = peer.call(hostId, localStream);
    handleStream(call);
  });

  peer.on('call', (call) => {
    call.answer(localStream);
    handleStream(call);
  });
}

function handleStream(call) {
  currentCall = call;
  call.on('stream', (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    remoteVideo.play().catch(() => {});
    statusElem.textContent = 'Связь установлена!';
  });
  call.on('close', () => {
    remoteVideo.srcObject = null;
    statusElem.textContent = 'Собеседник отключился.';
  });
}

// 4. Отключение
function leaveRoom() {
  if (currentRoom) {
    unregisterRoom(currentRoom);
  }

  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }

  remoteVideo.srcObject = null;
  currentRoom = null;
  isHost = false;

  window.history.pushState({}, '', window.location.pathname);

  joinSection.style.display = 'block';
  callSection.style.display = 'none';
  statusElem.textContent = 'Вы вышли из комнаты. Выберите новую.';
  updateRoomsDisplay();
}

window.addEventListener('beforeunload', () => {
  if (currentRoom && isHost) {
    unregisterRoom(currentRoom);
  }
});

joinBtn.addEventListener('click', () => joinRoom(roomInput.value));
leaveBtn.addEventListener('click', leaveRoom);

// Запуск
initCamera();  }
}

// 2. Вход в комнату с читаемым ID
function joinRoom(rawRoomName) {
  const room = rawRoomName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!room) {
    alert('Пожалуйста, используйте буквы и цифры для названия комнаты');
    return;
  }

  // Обновляем URL страницы для удобного копирования ссылки
  window.history.pushState({}, '', `?room=${room}`);

  if (peer) peer.destroy();

  statusElem.textContent = `Подключение к комнате «${room}»...`;

  const hostId = `room-${room}-host`;

  // Сначала пробуем зарегистрироваться как создатель комнаты (Host)
  peer = new Peer(hostId, peerConfig);

  peer.on('open', () => {
    statusElem.textContent = `Вы создали комнату «${room}». Ссылка скопирована! Отправьте её собеседнику.`;
    navigator.clipboard?.writeText(window.location.href);
  });

  // Обработка входящего звонка (если мы Хост и к нам подключился гость)
  peer.on('call', (call) => {
    statusElem.textContent = 'Собеседник подключился. Звонок активен.';
    call.answer(localStream);
    handleStream(call);
  });

  // Если Host-ID уже занят, значит мы второй участник (Гость)
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      connectAsGuest(room, hostId);
    } else {
      statusElem.textContent = 'Ошибка: ' + err.message;
    }
  });
}

// 3. Подключение в качестве гостя и звонок создателю комнаты
function connectAsGuest(room, hostId) {
  statusElem.textContent = `Подключение к владельцу комнаты «${room}»...`;
  
  // Создаем случайный ID для себя и звоним хосту
  peer = new Peer(peerConfig);

  peer.on('open', () => {
    const call = peer.call(hostId, localStream);
    handleStream(call);
  });

  peer.on('call', (call) => {
    call.answer(localStream);
    handleStream(call);
  });
}

function handleStream(call) {
  currentCall = call;
  call.on('stream', (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    statusElem.textContent = 'Связь установлена!';
  });
  call.on('close', () => {
    remoteVideo.srcObject = null;
    statusElem.textContent = 'Собеседник отключился.';
  });
}

function quickJoin(name) {
  roomInput.value = name;
  joinRoom(name);
}

joinBtn.addEventListener('click', () => joinRoom(roomInput.value));

initCamera();
  mqttClient.onMessageArrived = (message) => {
    try {
      const data = JSON.parse(message.payloadString);
      handleLobbySignal(data);
    } catch (e) {
      console.warn('MQTT parse error', e);
    }
  };

  mqttClient.connect({
    useSSL: true,
    onSuccess: () => {
      mqttClient.subscribe(MQTT_TOPIC);
      // Очистка неактивных комнат каждые 3 секунды
      setInterval(cleanExpiredRooms, 3000);
    },
    onFailure: (err) => console.log('MQTT Connect Failed:', err)
  });
}

function broadcastStatus(action, room) {
  if (!mqttClient || !mqttClient.isConnected()) return;
  const message = new Paho.MQTT.Message(JSON.stringify({ action, room, t: Date.now() }));
  message.destinationName = MQTT_TOPIC;
  mqttClient.send(message);
}

function handleLobbySignal(data) {
  if (data.action === 'waiting') {
    // В комнате ждет 1 человек (Хост)
    if (data.room !== currentRoom) {
      activeRoomsMap.set(data.room, Date.now());
      renderRoomsList();
    }
  } else if (data.action === 'busy' || data.action === 'closed') {
    // Подключился 2-й участник (комната заполнена) или хост вышел
    activeRoomsMap.delete(data.room);
    renderRoomsList();
  }
}

function cleanExpiredRooms() {
  const now = Date.now();
  let changed = false;
  for (const [room, timestamp] of activeRoomsMap.entries()) {
    if (now - timestamp > 7000) { // Если хост не отправлял пинг более 7 сек
      activeRoomsMap.delete(room);
      changed = true;
    }
  }
  if (changed) renderRoomsList();
}

function renderRoomsList() {
  availableRoomsElem.innerHTML = '';
  const rooms = Array.from(activeRoomsMap.keys());

  if (rooms.length === 0) {
    availableRoomsElem.innerHTML = '<span style="color: #666; font-size: 13px;">Свободных комнат нет. Создайте первую!</span>';
    return;
  }

  rooms.forEach(room => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `<span class="status-dot"></span>${room} (ждёт 1)`;
    tag.onclick = () => {
      roomInput.value = room;
      joinRoom(room);
    };
    availableRoomsElem.appendChild(tag);
  });
}

// --- Инициализация камеры ---
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    statusElem.textContent = 'Камера готова. Выберите комнату или введите своё название.';
    
    initLobbyTracker();

    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      roomInput.value = roomParam;
      joinRoom(roomParam);
    }
  } catch (err) {
    statusElem.textContent = 'Ошибка доступа к медиаустройствам: ' + err.message;
  }
}

// --- Логика звонков ---
function joinRoom(rawRoomName) {
  const room = rawRoomName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!room) {
    alert('Пожалуйста, используйте латинские буквы и цифры');
    return;
  }

  currentRoom = room;
  window.history.pushState({}, '', `?room=${room}`);

  joinSection.style.display = 'none';
  callSection.style.display = 'block';
  currentRoomInfo.textContent = `Текущая комната: ${room}`;

  if (peer) peer.destroy();

  const hostId = `room-${room}-host`;

  // Попытка стать хостом
  peer = new Peer(hostId, peerConfig);

  peer.on('open', () => {
    isHost = true;
    statusElem.textContent = `Вы создали комнату «${room}». Ожидаем собеседника...`;
    navigator.clipboard?.writeText(window.location.href);

    // Оповещаем всех в лобби, что мы ждем (1 чел.)
    broadcastStatus('waiting', currentRoom);
    heartbeatTimer = setInterval(() => broadcastStatus('waiting', currentRoom), 3000);
  });

  peer.on('call', (call) => {
    // Второй участник зашел -> комната заполнена
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    broadcastStatus('busy', currentRoom);

    statusElem.textContent = 'Собеседник подключился. Звонок активен.';
    call.answer(localStream);
    handleStream(call);
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // Хост уже есть -> подключаемся как гость
      connectAsGuest(room, hostId);
    } else {
      statusElem.textContent = 'Ошибка соединения: ' + err.message;
    }
  });
}

function connectAsGuest(room, hostId) {
  isHost = false;
  statusElem.textContent = `Подключение к комнате «${room}»...`;
  
  peer = new Peer(peerConfig);

  peer.on('open', () => {
    // Сообщаем лобби, что комната занята (2/2)
    broadcastStatus('busy', room);
    const call = peer.call(hostId, localStream);
    handleStream(call);
  });

  peer.on('call', (call) => {
    call.answer(localStream);
    handleStream(call);
  });
}

function handleStream(call) {
  currentCall = call;
  call.on('stream', (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    statusElem.textContent = 'Связь установлена!';
  });
  call.on('close', () => {
    remoteVideo.srcObject = null;
    statusElem.textContent = 'Собеседник отключился.';
  });
}

// --- Выход из комнаты ---
function leaveRoom() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (currentRoom) {
    broadcastStatus('closed', currentRoom);
  }

  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }

  remoteVideo.srcObject = null;
  currentRoom = null;
  isHost = false;

  window.history.pushState({}, '', window.location.pathname);

  joinSection.style.display = 'block';
  callSection.style.display = 'none';
  statusElem.textContent = 'Вы вышли из комнаты. Выберите новую.';
}

joinBtn.addEventListener('click', () => joinRoom(roomInput.value));
leaveBtn.addEventListener('click', leaveRoom);

initCamera();
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      roomInput.value = roomParam;
      joinRoom(roomParam);
    }
  } catch (err) {
    statusElem.textContent = 'Ошибка доступа к камере/микрофону: ' + err.message;
  }
}

// --- 2. ЛОББИ КОМНАТ ЧЕРЕЗ ЧИСТЫЙ WEBSOCKET ---
let ws = null;
const activeRoomsMap = new Map();

function initWsLobby() {
  // Публичный открытый сокет-канал для координации
  ws = new WebSocket('wss://demo.piesocket.com/v3/channel_p2p_video_lobby?api_key=VC3oaf مواجهة-demo-key-123456');

  ws.onopen = () => {
    // При подключении спрашиваем у всех: "Кто сейчас ждет?"
    sendWsMessage('discover', '');
    setInterval(cleanExpiredRooms, 3000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.action === 'discover') {
        if (isHost && currentRoom && !currentCall) {
          sendWsMessage('waiting', currentRoom);
        }
      } else if (data.action === 'waiting') {
        if (data.room !== currentRoom) {
          activeRoomsMap.set(data.room, Date.now());
          renderRoomsList();
        }
      } else if (data.action === 'busy' || data.action === 'closed') {
        activeRoomsMap.delete(data.room);
        renderRoomsList();
      }
    } catch (e) {}
  };

  ws.onerror = () => {};
}

function sendWsMessage(action, room) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action, room, t: Date.now() }));
  }
}

function cleanExpiredRooms() {
  const now = Date.now();
  let changed = false;
  for (const [room, time] of activeRoomsMap.entries()) {
    if (now - time > 8000) {
      activeRoomsMap.delete(room);
      changed = true;
    }
  }
  if (changed) renderRoomsList();
}

function renderRoomsList() {
  availableRoomsElem.innerHTML = '';
  const rooms = Array.from(activeRoomsMap.keys());

  if (rooms.length === 0) {
    availableRoomsElem.innerHTML = '<span style="color: #666; font-size: 13px;">Свободных комнат нет. Создайте первую!</span>';
    return;
  }

  rooms.forEach(room => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `<span class="status-dot"></span>${room} (ждёт 1)`;
    tag.onclick = () => {
      roomInput.value = room;
      joinRoom(room);
    };
    availableRoomsElem.appendChild(tag);
  });
}

// --- 3. ЗВОНКИ WEBRTC (PEERJS) ---
function joinRoom(rawRoomName) {
  const room = rawRoomName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!room) {
    alert('Используйте только латинские буквы и цифры');
    return;
  }

  currentRoom = room;
  window.history.pushState({}, '', `?room=${room}`);

  joinSection.style.display = 'none';
  callSection.style.display = 'block';
  currentRoomInfo.textContent = `Текущая комната: ${room}`;

  if (peer) peer.destroy();

  const hostId = `p2p-call-${room}-host`;
  peer = new Peer(hostId, peerConfig);

  peer.on('open', () => {
    isHost = true;
    statusElem.textContent = `Вы создали комнату «${room}». Ссылка скопирована! Ожидаем собеседника...`;
    navigator.clipboard?.writeText(window.location.href);

    sendWsMessage('waiting', currentRoom);
    heartbeatTimer = setInterval(() => sendWsMessage('waiting', currentRoom), 2500);
  });

  peer.on('call', (call) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    sendWsMessage('busy', currentRoom);

    statusElem.textContent = 'Собеседник подключился. Звонок активен.';
    call.answer(localStream);
    handleStream(call);
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      connectAsGuest(room, hostId);
    } else {
      statusElem.textContent = 'Ошибка Peer: ' + err.message;
    }
  });
}

function connectAsGuest(room, hostId) {
  isHost = false;
  statusElem.textContent = `Подключение к владельцу комнаты «${room}»...`;
  
  peer = new Peer(peerConfig);

  peer.on('open', () => {
    sendWsMessage('busy', room);
    const call = peer.call(hostId, localStream);
    handleStream(call);
  });

  peer.on('call', (call) => {
    call.answer(localStream);
    handleStream(call);
  });
}

function handleStream(call) {
  currentCall = call;
  call.on('stream', (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    statusElem.textContent = 'Связь установлена!';
  });
  call.on('close', () => {
    remoteVideo.srcObject = null;
    statusElem.textContent = 'Собеседник отключился.';
  });
}

// --- 4. ВЫХОД ИЗ КОМНАТЫ ---
function leaveRoom() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (currentRoom) sendWsMessage('closed', currentRoom);

  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }

  remoteVideo.srcObject = null;
  currentRoom = null;
  isHost = false;

  window.history.pushState({}, '', window.location.pathname);

  joinSection.style.display = 'block';
  callSection.style.display = 'none';
  statusElem.textContent = 'Вы вышли из комнаты. Выберите новую.';

  sendWsMessage('discover', '');
}

window.addEventListener('beforeunload', () => {
  if (currentRoom && isHost) sendWsMessage('closed', currentRoom);
});

joinBtn.addEventListener('click', () => joinRoom(roomInput.value));
leaveBtn.addEventListener('click', leaveRoom);

initCamera();  mqttClient.onMessageArrived = (message) => {
    try {
      const data = JSON.parse(message.payloadString);
      handleLobbySignal(data);
    } catch (e) {
      console.warn('MQTT parse error', e);
    }
  };

  mqttClient.connect({
    useSSL: true,
    timeout: 5,
    onSuccess: () => {
      mqttClient.subscribe(MQTT_TOPIC, {
        onSuccess: () => {
          // 1. Сразу при подключении запрашиваем список у всех, кто онлайн
          broadcastStatus('discover', '');
        }
      });
      // Очистка неактивных комнат каждые 3 секунды
      setInterval(cleanExpiredRooms, 3000);
    },
    onFailure: (err) => console.log('MQTT Connect Failed:', err)
  });
}

function broadcastStatus(action, room) {
  if (!mqttClient || !mqttClient.isConnected()) return;
  const message = new Paho.MQTT.Message(JSON.stringify({ action, room, t: Date.now() }));
  message.destinationName = MQTT_TOPIC;
  mqttClient.send(message);
}

function handleLobbySignal(data) {
  // Запрос от новичка: "Кто ждет?" -> если мы хост, сразу отвечаем
  if (data.action === 'discover') {
    if (isHost && currentRoom && !currentCall) {
      broadcastStatus('waiting', currentRoom);
    }
    return;
  }

  if (data.action === 'waiting') {
    // В комнате ждет создатель
    if (data.room !== currentRoom) {
      activeRoomsMap.set(data.room, Date.now());
      renderRoomsList();
    }
  } else if (data.action === 'busy' || data.action === 'closed') {
    // Комната заполнена или удалена
    activeRoomsMap.delete(data.room);
    renderRoomsList();
  }
}

function cleanExpiredRooms() {
  const now = Date.now();
  let changed = false;
  for (const [room, timestamp] of activeRoomsMap.entries()) {
    if (now - timestamp > 8000) { // Если пинга не было 8 сек — удаляем
      activeRoomsMap.delete(room);
      changed = true;
    }
  }
  if (changed) renderRoomsList();
}

function renderRoomsList() {
  availableRoomsElem.innerHTML = '';
  const rooms = Array.from(activeRoomsMap.keys());

  if (rooms.length === 0) {
    availableRoomsElem.innerHTML = '<span style="color: #666; font-size: 13px;">Свободных комнат нет. Создайте первую!</span>';
    return;
  }

  rooms.forEach(room => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `<span class="status-dot"></span>${room} (ждёт 1)`;
    tag.onclick = () => {
      roomInput.value = room;
      joinRoom(room);
    };
    availableRoomsElem.appendChild(tag);
  });
}

// --- Инициализация камеры ---
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    statusElem.textContent = 'Камера готова. Выберите комнату или создайте свою.';
    
    initLobbyTracker();

    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      roomInput.value = roomParam;
      joinRoom(roomParam);
    }
  } catch (err) {
    statusElem.textContent = 'Ошибка доступа к медиаустройствам: ' + err.message;
  }
}

// --- Логика звонка ---
function joinRoom(rawRoomName) {
  const room = rawRoomName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!room) {
    alert('Используйте только латинские буквы и цифры');
    return;
  }

  currentRoom = room;
  window.history.pushState({}, '', `?room=${room}`);

  joinSection.style.display = 'none';
  callSection.style.display = 'block';
  currentRoomInfo.textContent = `Текущая комната: ${room}`;

  if (peer) peer.destroy();

  const hostId = `p2p-call-${room}-host`;

  peer = new Peer(hostId, peerConfig);

  peer.on('open', () => {
    isHost = true;
    statusElem.textContent = `Вы создали комнату «${room}». Ссылка скопирована! Ждем собеседника...`;
    navigator.clipboard?.writeText(window.location.href);

    // Сразу рассылаем статус и запускаем периодический пинг каждые 2.5 секунды
    broadcastStatus('waiting', currentRoom);
    heartbeatTimer = setInterval(() => broadcastStatus('waiting', currentRoom), 2500);
  });

  peer.on('call', (call) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    broadcastStatus('busy', currentRoom);

    statusElem.textContent = 'Собеседник подключился. Звонок активен.';
    call.answer(localStream);
    handleStream(call);
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      connectAsGuest(room, hostId);
    } else {
      statusElem.textContent = 'Ошибка соединения: ' + err.message;
    }
  });
}

function connectAsGuest(room, hostId) {
  isHost = false;
  statusElem.textContent = `Подключение к владельцу комнаты «${room}»...`;
  
  peer = new Peer(peerConfig);

  peer.on('open', () => {
    broadcastStatus('busy', room);
    const call = peer.call(hostId, localStream);
    handleStream(call);
  });

  peer.on('call', (call) => {
    call.answer(localStream);
    handleStream(call);
  });
}

function handleStream(call) {
  currentCall = call;
  call.on('stream', (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    statusElem.textContent = 'Связь установлена!';
  });
  call.on('close', () => {
    remoteVideo.srcObject = null;
    statusElem.textContent = 'Собеседник отключился.';
  });
}

// --- Выход и закрытие вкладки ---
function leaveRoom() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (currentRoom) {
    broadcastStatus('closed', currentRoom);
  }

  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }

  remoteVideo.srcObject = null;
  currentRoom = null;
  isHost = false;

  window.history.pushState({}, '', window.location.pathname);

  joinSection.style.display = 'block';
  callSection.style.display = 'none';
  statusElem.textContent = 'Вы вышли из комнаты.';

  // Запрашиваем актуальный список доступных комнат
  broadcastStatus('discover', '');
}

window.addEventListener('beforeunload', () => {
  if (currentRoom && isHost) {
    broadcastStatus('closed', currentRoom);
  }
});

joinBtn.addEventListener('click', () => joinRoom(roomInput.value));
leaveBtn.addEventListener('click', leaveRoom);

initCamera();
  mqttClient.onMessageArrived = (message) => {
    try {
      const data = JSON.parse(message.payloadString);
      handleLobbySignal(data);
    } catch (e) {
      console.warn('MQTT parse error', e);
    }
  };

  mqttClient.connect({
    useSSL: true,
    onSuccess: () => {
      mqttClient.subscribe(MQTT_TOPIC);
      // Очистка неактивных комнат каждые 3 секунды
      setInterval(cleanExpiredRooms, 3000);
    },
    onFailure: (err) => console.log('MQTT Connect Failed:', err)
  });
}

function broadcastStatus(action, room) {
  if (!mqttClient || !mqttClient.isConnected()) return;
  const message = new Paho.MQTT.Message(JSON.stringify({ action, room, t: Date.now() }));
  message.destinationName = MQTT_TOPIC;
  mqttClient.send(message);
}

function handleLobbySignal(data) {
  if (data.action === 'waiting') {
    // В комнате ждет 1 человек (Хост)
    if (data.room !== currentRoom) {
      activeRoomsMap.set(data.room, Date.now());
      renderRoomsList();
    }
  } else if (data.action === 'busy' || data.action === 'closed') {
    // Подключился 2-й участник (комната заполнена) или хост вышел
    activeRoomsMap.delete(data.room);
    renderRoomsList();
  }
}

function cleanExpiredRooms() {
  const now = Date.now();
  let changed = false;
  for (const [room, timestamp] of activeRoomsMap.entries()) {
    if (now - timestamp > 7000) { // Если хост не отправлял пинг более 7 сек
      activeRoomsMap.delete(room);
      changed = true;
    }
  }
  if (changed) renderRoomsList();
}

function renderRoomsList() {
  availableRoomsElem.innerHTML = '';
  const rooms = Array.from(activeRoomsMap.keys());

  if (rooms.length === 0) {
    availableRoomsElem.innerHTML = '<span style="color: #666; font-size: 13px;">Свободных комнат нет. Создайте первую!</span>';
    return;
  }

  rooms.forEach(room => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `<span class="status-dot"></span>${room} (ждёт 1)`;
    tag.onclick = () => {
      roomInput.value = room;
      joinRoom(room);
    };
    availableRoomsElem.appendChild(tag);
  });
}

// --- Инициализация камеры ---
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    statusElem.textContent = 'Камера готова. Выберите комнату или введите своё название.';
    
    initLobbyTracker();

    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      roomInput.value = roomParam;
      joinRoom(roomParam);
    }
  } catch (err) {
    statusElem.textContent = 'Ошибка доступа к медиаустройствам: ' + err.message;
  }
}

// --- Логика звонков ---
function joinRoom(rawRoomName) {
  const room = rawRoomName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!room) {
    alert('Пожалуйста, используйте латинские буквы и цифры');
    return;
  }

  currentRoom = room;
  window.history.pushState({}, '', `?room=${room}`);

  joinSection.style.display = 'none';
  callSection.style.display = 'block';
  currentRoomInfo.textContent = `Текущая комната: ${room}`;

  if (peer) peer.destroy();

  const hostId = `room-${room}-host`;

  // Попытка стать хостом
  peer = new Peer(hostId, peerConfig);

  peer.on('open', () => {
    isHost = true;
    statusElem.textContent = `Вы создали комнату «${room}». Ожидаем собеседника...`;
    navigator.clipboard?.writeText(window.location.href);

    // Оповещаем всех в лобби, что мы ждем (1 чел.)
    broadcastStatus('waiting', currentRoom);
    heartbeatTimer = setInterval(() => broadcastStatus('waiting', currentRoom), 3000);
  });

  peer.on('call', (call) => {
    // Второй участник зашел -> комната заполнена
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    broadcastStatus('busy', currentRoom);

    statusElem.textContent = 'Собеседник подключился. Звонок активен.';
    call.answer(localStream);
    handleStream(call);
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // Хост уже есть -> подключаемся как гость
      connectAsGuest(room, hostId);
    } else {
      statusElem.textContent = 'Ошибка соединения: ' + err.message;
    }
  });
}

function connectAsGuest(room, hostId) {
  isHost = false;
  statusElem.textContent = `Подключение к комнате «${room}»...`;
  
  peer = new Peer(peerConfig);

  peer.on('open', () => {
    // Сообщаем лобби, что комната занята (2/2)
    broadcastStatus('busy', room);
    const call = peer.call(hostId, localStream);
    handleStream(call);
  });

  peer.on('call', (call) => {
    call.answer(localStream);
    handleStream(call);
  });
}

function handleStream(call) {
  currentCall = call;
  call.on('stream', (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    statusElem.textContent = 'Связь установлена!';
  });
  call.on('close', () => {
    remoteVideo.srcObject = null;
    statusElem.textContent = 'Собеседник отключился.';
  });
}

// --- Выход из комнаты ---
function leaveRoom() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (currentRoom) {
    broadcastStatus('closed', currentRoom);
  }

  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }

  remoteVideo.srcObject = null;
  currentRoom = null;
  isHost = false;

  window.history.pushState({}, '', window.location.pathname);

  joinSection.style.display = 'block';
  callSection.style.display = 'none';
  statusElem.textContent = 'Вы вышли из комнаты. Выберите новую.';
}

joinBtn.addEventListener('click', () => joinRoom(roomInput.value));
leaveBtn.addEventListener('click', leaveRoom);

initCamera();
