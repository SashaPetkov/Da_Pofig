const myIdElem = document.getElementById('my-id');
const peerIdInput = document.getElementById('peer-id-input');
const callBtn = document.getElementById('call-btn');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const statusElem = document.getElementById('status');

let localStream = null;

// 1. Инициализация PeerJS (подключение к бесплатному сигнальному серверу)
const peer = new Peer({
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
});

// Получаем наш уникальный ID при успешном подключении
peer.on('open', (id) => {
  myIdElem.textContent = id;
  statusElem.textContent = 'Готов к звонку. Скопируйте ваш ID и отправьте собеседнику.';
});

// 2. Получение доступа к локальной камере и микрофону
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;
  } catch (err) {
    statusElem.textContent = 'Ошибка доступа к камере/микрофону: ' + err.message;
  }
}

initMedia();

// 3. Обработка ВХОДЯЩЕГО звонка
peer.on('call', (call) => {
  statusElem.textContent = 'Входящий звонок... Соединение установлено.';
  
  // Отвечаем на звонок и отправляем свой видеопоток
  call.answer(localStream);
  
  // Получаем видеопоток звонящего
  call.on('stream', (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
  });

  call.on('close', () => {
    statusElem.textContent = 'Звонок завершён.';
    remoteVideo.srcObject = null;
  });
});

// 4. Логика ИСХОДЯЩЕГО звонка (по нажатию кнопки)
callBtn.addEventListener('click', () => {
  const remotePeerId = peerIdInput.value.trim();
  if (!remotePeerId) {
    alert('Пожалуйста, введите ID собеседника');
    return;
  }

  statusElem.textContent = `Звоним ${remotePeerId}...`;

  // Инициируем вызов
  const call = peer.call(remotePeerId, localStream);

  // Получаем видеопоток принимающей стороны
  call.on('stream', (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    statusElem.textContent = 'Собеседник ответил. Связь активна.';
  });

  call.on('close', () => {
    statusElem.textContent = 'Звонок завершён.';
    remoteVideo.srcObject = null;
  });

  call.on('error', (err) => {
    statusElem.textContent = 'Ошибка соединения: ' + err.message;
  });
});
