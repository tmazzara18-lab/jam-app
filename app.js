
// ===== DOM ELEMENTS =====
const roomIdInput = document.getElementById('roomId');
const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('startBtn');

const voiceSelect = document.getElementById('voiceSelect');
const instrumentSelect = document.getElementById('instrumentSelect');
const videoToggle = document.getElementById('videoToggle');

const localVideo = document.getElementById('localVideo');
const localVoice = document.getElementById('localVoice');
const localInstrument = document.getElementById('localInstrument');
const remoteVideo = document.getElementById('remoteVideo');
const remoteAudios = document.getElementById('remoteAudios');

// ===== GLOBALS =====
let localStream;
let pc; // RTCPeerConnection
let socket;

// ===== POPULATE DEVICE SELECTORS =====
async function populateInputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  voiceSelect.innerHTML = '';
  instrumentSelect.innerHTML = '';

  devices.filter(d => d.kind === 'audioinput').forEach((mic, i) => {
    const option = document.createElement('option');
    option.value = mic.deviceId;
    option.text = mic.label || `Microphone ${i+1}`;
    voiceSelect.appendChild(option.cloneNode(true));
    instrumentSelect.appendChild(option.cloneNode(true));
  });
}

// ===== ENABLE START BUTTON =====
roomIdInput.addEventListener('input', () => {
  startBtn.disabled = !roomIdInput.value.trim();
});

// ===== JOIN ROOM BUTTON =====
joinBtn.addEventListener('click', () => {
  const roomId = roomIdInput.value.trim();
  if (!roomId) return alert('Enter a Room ID!');
  startBtn.disabled = false;

  // Connect to backend WebSocket
  socket = new WebSocket(`wss://jam-server-6ew4.onrender.com?room=${roomId}`);

  socket.onopen = () => console.log('Connected to backend WebSocket!');
  socket.onmessage = async (msg) => {
    const data = JSON.parse(msg.data);

    if (data.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.send(JSON.stringify({ type: 'answer', answer }));
    }

    if (data.type === 'ice-candidate') {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    }
  };
});

// ===== START JAM =====
startBtn.addEventListener('click', async () => {
  try {
    const selectedVoice = voiceSelect.value;
    const constraints = {
      video: videoToggle.checked,
      audio: { deviceId: selectedVoice ? { exact: selectedVoice } : undefined },
    };

    // Capture local media
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (videoToggle.checked) localVideo.srcObject = localStream;

    // Create WebRTC peer connection
    pc = new RTCPeerConnection();

    // Add local tracks
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // Handle remote tracks
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach(track => {
        if (track.kind === 'video') remoteVideo.srcObject = event.streams[0];
        if (track.kind === 'audio') {
          const audioEl = document.createElement('audio');
          audioEl.autoplay = true;
          audioEl.srcObject = new MediaStream([track]);
          remoteAudios.appendChild(audioEl);
        }
      });
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate }));
      }
    };

    // Create offer and send to server
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.send(JSON.stringify({ type: 'offer', offer }));

    alert('Jam started! Your media is live.');
  } catch (err) {
    console.error('Failed to start jam:', err);
    alert('Error starting jam. Check console for details.');
  }
});

// ===== INITIALIZE =====
populateInputs();