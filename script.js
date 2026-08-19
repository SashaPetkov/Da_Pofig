const statusElem = document.getElementById('status');
const roomControls = document.getElementById('room-controls');
const joinSection = document.getElementById('join-section');
const callSection = document.getElementById('call-section');
const currentRoomInfo = document.getElementById('current-room-info');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

let localStream = null;
let peer = null;
let currentCall = null;
let currentRoom = null;

const peerConfig = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};

// 1. Инициализация камеры (как в исходной рабочей версии)
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    statusElem.textContent = 'Камера готова. Введите название комнаты или выберите из списка.';
    
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

// 2. Вход в комнату
function joinRoom(rawRoomName) {
  const room = rawRoomName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!room) {
    alert('Пожалуйста, используйте буквы и цифры для названия комнаты');
    return;
  }

  currentRoom = room;
  window.history.pushState({}, '', `?room=${room}`);

  // Переключаем интерфейс
  joinSection.style.display = 'none';
  callSection.style.display = 'block';
  currentRoomInfo.textContent = `Текущая комната: ${room}`;

  if (peer) peer.destroy();

  statusElem.textContent = `Подключение к комнате «${room}»...`;

  const hostId = `room-${room}-host`;

  // Регистрация в роли хоста
  peer = new Peer(hostId, peerConfig);

  peer.on('open', () => {
    statusElem.textContent = `Вы создали комнату «${room}». Ссылка скопирована! Ждем собеседника.`;
    navigator.clipboard?.writeText(window.location.href);
  });

  peer.on('call', (call) => {
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

// 3. Подключение второго участника (гостя)
function connectAsGuest(room, hostId) {
  statusElem.textContent = `Подключение к владельцу комнаты «${room}»...`;
  
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

// 4. Отключение от комнаты
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
  currentRoom = null;

  // Очищаем адресную строку
  window.history.pushState({}, '', window.location.pathname);

  // Возвращаем форму выбора комнат
  joinSection.style.display = 'block';
  callSection.style.display = 'none';
  statusElem.textContent = 'Вы вышли из комнаты. Выберите новую.';
}

function quickJoin(name) {
  roomInput.value = name;
  joinRoom(name);
}

joinBtn.addEventListener('click', () => joinRoom(roomInput.value));
leaveBtn.addEventListener('click', leaveRoom);

initCamera();
