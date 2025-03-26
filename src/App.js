import React, { useEffect, useRef, useState } from 'react';
import { HubConnectionBuilder } from '@microsoft/signalr';
import SimplePeer from 'simple-peer';

// Полифиллы для совместимости
if (typeof window !== 'undefined') {
  if (!window.process) window.process = {};
  window.process.nextTick = window.process.nextTick || ((fn) => setTimeout(fn, 0));
  window.Buffer = window.Buffer || require('buffer').Buffer;
}

const App = () => {
  const [username, setUsername] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [otherUsers, setOtherUsers] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  const connectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef({});
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const roomId = "default-room";

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
      setIsLoading(true);
      setIsAuthenticated(true);
    }
  };

  const getMediaStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      localStreamRef.current = stream;
      localVideoRef.current.srcObject = stream;
    } catch (err) {
      console.error("Failed to get media stream:", err);
      setIsLoading(false);
      alert("Не удалось получить доступ к камере/микрофону");
    }
  };

  const createPeer = (userId, initiator, signal = null) => {
    if (peersRef.current[userId] || !localStreamRef.current) return;
  
    const peer = new SimplePeer({
      initiator,
      stream: localStreamRef.current,
      config: {
        iceServers: [
          {
            urls: 'stun:109.73.198.135:3478',
            username: 'test',
            credential: 'test123',
          },
          {
            urls: 'turn:109.73.198.135:3478',
            username: 'test',
            credential: 'test123'
          }
        ]
      },
      trickle: true
    });
  
    peer.on('signal', data => {
      if (connectionRef.current?.state === 'Connected') {
        connectionRef.current.invoke("SendSignal", userId, data)
          .catch(err => console.error("Error sending signal:", err));
      }
    });
  
    peer.on('stream', stream => {
      if (!remoteVideoRefs.current[userId]) {
        const videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.style.width = '300px';
        remoteVideoRefs.current[userId] = videoElement;
        document.getElementById('remoteVideosContainer').appendChild(videoElement);
      }
      remoteVideoRefs.current[userId].srcObject = stream;
    });

    peer.on('error', err => {
      console.error('Peer error:', err);
      safeCleanupPeer(userId);
    });

    if (signal) {
      peer.signal(signal);
    }
  
    peersRef.current[userId] = peer;
  };

  const safeCleanupPeer = (userId) => {
    if (peersRef.current[userId]) {
      peersRef.current[userId].destroy();
      delete peersRef.current[userId];
    }
    
    if (remoteVideoRefs.current[userId]) {
      remoteVideoRefs.current[userId].srcObject = null;
      remoteVideoRefs.current[userId].remove();
      delete remoteVideoRefs.current[userId];
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
  
    const startConnection = async () => {
      await getMediaStream();
      
      const conn = new HubConnectionBuilder()
        .withUrl("https://mug1vara97-webrtcback-3099.twc1.net/webrtc-hub")
        .withAutomaticReconnect()
        .build();
  
      conn.on("UsersInRoom", users => {
        setOtherUsers(users);
        users.forEach(userId => createPeer(userId, true));
      });
  
      conn.on("UserJoined", userId => {
        setOtherUsers(prev => [...prev, userId]);
        createPeer(userId, true);
      });
  
      conn.on("UserLeft", userId => {
        setOtherUsers(prev => prev.filter(id => id !== userId));
        safeCleanupPeer(userId);
      });
  
      conn.on("ReceiveSignal", (senderId, signal) => {
        if (!peersRef.current[senderId]) {
          createPeer(senderId, false, signal);
        } else {
          peersRef.current[senderId].signal(signal);
        }
      });
  
      conn.onclose(() => setConnectionStatus('disconnected'));
      conn.onreconnecting(() => setConnectionStatus('reconnecting'));
      conn.onreconnected(() => setConnectionStatus('connected'));
  
      try {
        await conn.start();
        setConnectionStatus('connected');
        await conn.invoke("JoinRoom", roomId, username);
        connectionRef.current = conn;
        setIsLoading(false);
      } catch (err) {
        console.error("Connection failed:", err);
        setIsLoading(false);
      }
    };
  
    startConnection();
  
    return () => {
      connectionRef.current?.stop();
      Object.values(peersRef.current).forEach(peer => peer.destroy());
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [isAuthenticated, username]);

  if (!isAuthenticated) {
    return (
      <div style={{ padding: '20px' }}>
        <h2>Вход в видеокомнату</h2>
        <form onSubmit={handleLogin}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Введите ваше имя"
            required
          />
          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Подключение...' : 'Войти'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Комната #{roomId}</h2>
      <p>Вы: {username}</p>
      <p>Участники: {otherUsers.length ? otherUsers.join(', ') : 'нет других участников'}</p>
      
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        <button onClick={toggleMute} style={{ backgroundColor: isMuted ? 'red' : 'green' }}>
          {isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
        </button>
        <button onClick={toggleVideo} style={{ backgroundColor: isVideoOff ? 'red' : 'green' }}>
          {isVideoOff ? 'Включить камеру' : 'Выключить камеру'}
        </button>
      </div>
      
      <div style={{ display: 'flex', gap: '20px' }}>
        <div>
          <h3>Ваша камера</h3>
          <video 
            ref={localVideoRef} 
            autoPlay 
            muted 
            playsInline 
            style={{ 
              width: '300px', 
              display: isVideoOff ? 'none' : 'block'
            }}
          />
          {isVideoOff && <div>Камера выключена</div>}
        </div>
        
        <div>
          <h3>Участники</h3>
          <div id="remoteVideosContainer" style={{ display: 'flex', gap: '20px' }} />
        </div>
      </div>
    </div>
  );
};

export default App;