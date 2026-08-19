const statusElem = document.getElementById('status');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

let localStream = null;
let peer = null;
let currentCall = null;

// STUN-серверы для обхода NAT
const peerConfig = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};

// 1. Получаем доступ к камере
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    statusElem.textContent = 'Камера готова. Введите название комнаты или выберите из списка.';
    
    // Проверяем, передана ли комната через URL (?room=название)
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
