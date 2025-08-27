const $ = (sel) => document.querySelector(sel);

const roomIdEl = $('#roomId');
const joinBtn = $('#joinBtn');
const voiceSelect = $('#voiceSelect');
const instrumentSelect = $('#instrumentSelect');
const videoToggle = $('#videoToggle');
const startBtn = $('#startBtn');
const localVideo = $('#localVideo');
const localVoice = $('#localVoice');
const localInstrument = $('#localInstrument');
const remoteVideo = $('#remoteVideo');
const remoteAudios = $('#remoteAudios');

let ws;
let pc;
let localVoiceTrack, localInstrumentTrack, localVideoTrack;
let joined = false;
let hasStarted = false;

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter(d => d.kind === 'audioinput');
  voiceSelect.innerHTML = audioInputs.map(d => `<option value="${d.deviceId}">${d.label || '(mic) ' + d.deviceId.slice(0,6)}</option>`).join('');
  instrumentSelect.innerHTML = audioInputs.map(d => `<option value="${d.deviceId}">${d.label || '(input) ' + d.deviceId.slice(0,6)}</option>`).join('');
}

async function getVoiceStream(deviceId) {
  return await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
      sampleSize: 16
    },
    video: false
  });
}

async function getInstrumentStream(deviceId) {
  return await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
      sampleRate: 48000,
      sampleSize: 16
    },
    video: false
  });
}

async function getVideoStream() {
  return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
}

function connectWS(room) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket('wss://jam-server-6ew4.onrender.com');
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', room }));
      resolve();
    };
    ws.onerror = reject;
    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'peer-joined') {
        // if already started, create/restart offer
        if (hasStarted) makeOffer();
      } else if (msg.type === 'signal') {
        const data = msg.data;
        if (data.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          if (pc.remoteDescription.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: 'signal', data: { sdp: pc.localDescription } }));
          }
        } else if (data.candidate) {
          try { await pc.addIceCandidate(data.candidate); } catch (e) { console.warn('ICE add error', e); }
        }
      } else if (msg.type === 'peer-left') {
        console.log('Peer left');
      }
    };
  });
}

function createPC() {
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302','stun:global.stun.twilio.com:3478'] }
    ]
  });
  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      ws?.send(JSON.stringify({ type: 'signal', data: { candidate: ev.candidate } }));
    }
  };
  pc.ontrack = (ev) => {
    const track = ev.track;
    if (track.kind === 'video') {
      const ms = ev.streams[0] || new MediaStream([track]);
      remoteVideo.srcObject = ms;
    } else if (track.kind === 'audio') {
      // create one audio element per track, so user can control levels independently later
      const ms = new MediaStream([track]);
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.controls = true;
      remoteAudios.appendChild(audioEl);
      audioEl.srcObject = ms;
    }
  };
}

async function makeOffer() {
  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: videoToggle.checked ? 1 : 0,
  });
  // Try to prefer low-latency Opus params
  let sdp = offer.sdp;
  sdp = sdp.replace(/useinbandfec=1/g, 'useinbandfec=1;stereo=1;maxaveragebitrate=128000;ptime=10');
  const modOffer = new RTCSessionDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(modOffer);
  ws?.send(JSON.stringify({ type: 'signal', data: { sdp: pc.localDescription } }));
}

async function startJam() {
  if (!joined) return alert('Join a room first.');
  if (hasStarted) return;
  hasStarted = true;

  createPC();

  // Get local voice/instrument/video
  const voiceDeviceId = voiceSelect.value;
  const instrumentDeviceId = instrumentSelect.value;

  const voiceStream = await getVoiceStream(voiceDeviceId);
  const instrStream = await getInstrumentStream(instrumentDeviceId);
  localVoice.srcObject = voiceStream;
  localInstrument.srcObject = instrStream;

  localVoiceTrack = voiceStream.getAudioTracks()[0];
  localVoiceTrack.contentHint = 'speech';

  localInstrumentTrack = instrStream.getAudioTracks()[0];
  localInstrumentTrack.contentHint = 'music';

  pc.addTrack(localVoiceTrack, new MediaStream());
  pc.addTrack(localInstrumentTrack, new MediaStream());

  if (videoToggle.checked) {
    const vStream = await getVideoStream();
    localVideo.srcObject = vStream;
    localVideoTrack = vStream.getVideoTracks()[0];
    pc.addTrack(localVideoTrack, vStream);
  }

  await makeOffer();
}

joinBtn.addEventListener('click', async () => {
  const room = roomIdEl.value.trim();
  if (!room) return alert('Enter a Room ID');
  await listDevices();
  await connectWS(room);
  joined = true;
  startBtn.disabled = false;
  joinBtn.disabled = true;
});

startBtn.addEventListener('click', startJam);

// Prime device labels by asking for permission once
(async () => {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {}
  await listDevices();
})();