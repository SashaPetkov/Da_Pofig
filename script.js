const statusElem = document.getElementById('status');
const permSection = document.getElementById('perm-section');
const enableMediaBtn = document.getElementById('enable-media-btn');
const roomControls = document.getElementById('room-controls');
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

const TRACKED_ROOMS = ['room-1', 'room-2', 'room-3', 'coffee-break', 'dubai-moscow'];

const peerConfig = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};

// 1. Мобильно-совместимый запрос медиа
async function requestMedia() {
  statusElem.textContent = 'Запрос доступа к камере...';

  // Мобильные constraints: фронтальная камера и стандартный битрейт
  const constraints = {
    audio: true,
    video: {
      facingMode: 'user',
      width: { ideal: 640 },
      height: { ideal: 480 }
    }
  };

  try {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
    
    // Принудительный запуск воспроизведения для мобильного Safari
    await localVideo.play().catch(() => {});

    permSection.style.display = 'none';
    roomControls.style.display = 'block';
    statusElem.textContent = 'Камера активна. Выберите комнату.';

    scanAvailableRooms();
    scanInterval = setInterval(scanAvailableRooms, 6000);

    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    if (room) {
      roomInput.value = room;
      joinRoom(room);
    }
  } catch (err) {
    statusElem.textContent = 'Ошибка: ' + err.name + ' - ' + err.message;
    console.error('Media error:', err);
  }
}

// 2. Сканирование свободных комнат
async function scanAvailableRooms() {
  if (currentRoomName) return;

  const activeRooms = [];
  for (const r of TRACKED_ROOMS) {
    const isOccupied = await checkHostExists(`p2p-call-${r}-host`);
    if (isOccupied) activeRooms.push(r);
  }
  renderRoomsList(activeRooms);
}

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
    tag.innerHTML = `<span class="status-dot"></span>${room}`;
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
  peer = new Peer(hostId, peerConfig);

  peer.on('open', () => {
    statusElem.textContent = `Вы создали комнату «${room}». Ожидание собеседника...`;
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
      statusElem.textContent = 'Ошибка Peer: ' + err.type;
    }
  });
}

// 4. Подключение гостя
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
  call.on('stream', async (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    try {
      await remoteVideo.play();
    } catch (e) {
      console.warn('Autoplay prevented:', e);
    }
    statusElem.textContent = 'Связь активна';
  });
  call.on('close', () => {
    remoteVideo.srcObject = null;
    statusElem.textContent = 'Собеседник покинул комнату.';
  });
}

// 5. Выход
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
  window.history.pushState({}, '', window.location.pathname);

  joinSection.style.display = 'block';
  callSection.style.display = 'none';
  statusElem.textContent = 'Вы вышли из комнаты.';

  scanAvailableRooms();
}

enableMediaBtn.addEventListener('click', requestMedia);
joinBtn.addEventListener('click', () => joinRoom(roomInput.value));
leaveBtn.addEventListener('click', leaveRoom);
