const statusElem = document.getElementById('status');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const joinSection = document.getElementById('join-section');
const callSection = document.getElementById('call-section');
const currentRoomInfo = document.getElementById('current-room-info');
const availableRoomsElem = document.getElementById('available-rooms');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

let localStream = null;
let peer = null;
let currentCall = null;
let currentRoomName = null;
let scanInterval = null;

// Предустановленный список комнат для автопоиска хостов
const TRACKED_ROOMS = ['room-1', 'room-2', 'room-3', 'coffee-break', 'dubai-moscow'];

const peerConfig = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};

// 1. Инициализация камеры
async function init() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    statusElem.textContent = 'Камера подключена. Выберите или создайте комнату.';
    
    // Запуск мониторинга свободных комнат
    scanAvailableRooms();
    scanInterval = setInterval(scanAvailableRooms, 6000);

    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    if (room) {
      roomInput.value = room;
      joinRoom(room);
    }
  } catch (err) {
    statusElem.textContent = 'Ошибка доступа к медиаустройствам: ' + err.message;
  }
}

// 2. Сканирование комнат (где ждет 1 человек)
async function scanAvailableRooms() {
  if (currentRoomName) return; // Не сканировать, если уже находимся в комнате

  const activeRooms = [];

  for (const r of TRACKED_ROOMS) {
    const isOccupied = await checkHostExists(`p2p-call-${r}-host`);
    if (isOccupied) {
      activeRooms.push(r);
    }
  }

  renderRoomsList(activeRooms);
}

// Проверка доступности хоста
function checkHostExists(hostId) {
  return new Promise((resolve) => {
    const tempPeer = new Peer(peerConfig);
    tempPeer.on('open', () => {
      const conn = tempPeer.connect(hostId);
      conn.on('open', () => {
        conn.close();
        tempPeer.destroy();
        resolve(true);
      });
      setTimeout(() => {
        tempPeer.destroy();
        resolve(false);
      }, 1200);
    });
    tempPeer.on('error', () => {
      tempPeer.destroy();
      resolve(false);
    });
  });
}

function renderRoomsList(rooms) {
  availableRoomsElem.innerHTML = '';
  if (rooms.length === 0) {
    availableRoomsElem.innerHTML = '<span style="color: #666; font-size: 13px;">Нет ожидающих комнат. Создайте свою!</span>';
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

// 3. Вход в комнату
function joinRoom(rawName) {
  const room = rawName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!room) return;

  currentRoomName = room;
  window.history.pushState({}, '', `?room=${room}`);

  joinSection.style.display = 'none';
  callSection.style.display = 'block';
  currentRoomInfo.textContent = `Комната: ${room}`;

  if (peer) peer.destroy();

  const hostId = `p2p-call-${room}-host`;

  // Попытка стать хостом
  peer = new Peer(hostId, peerConfig);

  peer.on('open', () => {
    statusElem.textContent = `Вы создали комнату «${room}». Ожидание второго участника...`;
    
    // Обработка дата-канала для функции обнаружения комнат
    peer.on('connection', (conn) => {
      conn.on('open', () => conn.close());
    });
  });

  peer.on('call', (call) => {
    statusElem.textContent = 'Собеседник подключился!';
    call.answer(localStream);
    handleCall(call);
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      connectAsGuest(room, hostId);
    } else {
      statusElem.textContent = 'Ошибка: ' + err.message;
    }
  });
}

// 4. Подключение гостя к хосту
function connectAsGuest(room, hostId) {
  statusElem.textContent = `Подключение к создателю комнаты «${room}»...`;
  peer = new Peer(peerConfig);

  peer.on('open', () => {
    const call = peer.call(hostId, localStream);
    handleCall(call);
  });

  peer.on('call', (call) => {
    call.answer(localStream);
    handleCall(call);
  });
}

function handleCall(call) {
  currentCall = call;
  call.on('stream', (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    statusElem.textContent = 'Связь активна';
  });
  call.on('close', () => {
    remoteVideo.srcObject = null;
    statusElem.textContent = 'Собеседник покинул комнату.';
  });
}

// 5. Выход из комнаты
function leaveRoom() {
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }

  if (peer) {
    peer.destroy();
    peer = null;
  }

  remoteVideo.srcObject = null;
  currentRoomName = null;

  // Очистка URL
  window.history.pushState({}, '', window.location.pathname);

  // Переключение интерфейса
  joinSection.style.display = 'block';
  callSection.style.display = 'none';
  statusElem.textContent = 'Вы вышли из комнаты. Выберите новую.';

  scanAvailableRooms();
}

joinBtn.addEventListener('click', () => joinRoom(roomInput.value));
leaveBtn.addEventListener('click', leaveRoom);

init();  }
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
