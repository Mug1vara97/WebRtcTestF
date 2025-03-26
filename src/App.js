import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';

// Полифиллы
if (typeof window !== 'undefined') {
  window.process = window.process || { nextTick: (fn) => setTimeout(fn, 0) };
  window.Buffer = window.Buffer || require('buffer').Buffer;
}

const App = () => {
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  
  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const screenVideoRef = useRef(null);
  const remoteVideoRefs = useRef({});
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef({});
  const [isLoading, setIsLoading] = useState(false);

  // Настройки ICE серверов
  const iceServers = {
    iceServers: [
      { 
        urls: 'stun:109.73.198.135:3478',
        username: 'test',
        credential: 'test123' 
      },
      { 
        urls: 'turn:109.73.198.135:3478',
        username: 'test',
        credential: 'test123' 
      }
    ]
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      await startScreenShare();
    }
  };

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: true,
        audio: true 
      });
      
      screenStreamRef.current = stream;
      screenVideoRef.current.srcObject = stream;
      setIsScreenSharing(true);
      
      // Отправляем новый поток всем участникам
      Object.keys(peersRef.current).forEach(userId => {
        const sender = peersRef.current[userId].addStream(stream);
        peersRef.current[userId]._senders.push(sender);
      });

      stream.getTracks().forEach(track => {
        track.onended = () => {
          stopScreenShare();
        };
      });
    } catch (err) {
      console.error('Screen sharing error:', err);
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenVideoRef.current.srcObject = null;
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim() && roomId.trim()) {
      setIsLoading(true);
      connectToRoom();
    }
  };

  const connectToRoom = () => {
    const socket = io('https://mug1vara97-webrtcb-1778.twc1.net', {
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      socket.emit('joinRoom', { roomId, username });
      setIsAuthenticated(true);
      setIsLoading(false);
    });

    socket.on('participants', (users) => {
      setParticipants(users);
      if (localStreamRef.current) {
        users.forEach(user => {
          if (user.id !== socket.id && !peersRef.current[user.id]) {
            createPeer(user.id, true);
          }
        });
      }
    });

    socket.on('newParticipant', (user) => {
      setParticipants(prev => [...prev, user]);
      if (localStreamRef.current) {
        createPeer(user.id, true);
      }
    });

    socket.on('participantLeft', (userId) => {
      setParticipants(prev => prev.filter(p => p.id !== userId));
      removePeer(userId);
    });

    socket.on('signal', ({ senderId, signal }) => {
      if (peersRef.current[senderId]) {
        peersRef.current[senderId].signal(signal);
      } else if (localStreamRef.current) {
        createPeer(senderId, false, signal);
      }
    });

    socketRef.current = socket;
  };

  const createPeer = (userId, initiator, signal = null) => {
    if (peersRef.current[userId]) return;

    const peer = new SimplePeer({
      initiator,
      stream: localStreamRef.current,
      config: iceServers,
      trickle: true
    });

    peer.on('signal', data => {
      socketRef.current.emit('signal', { 
        targetId: userId, 
        signal: JSON.stringify(data) 
      });
    });

    peer.on('stream', stream => {
      if (!remoteVideoRefs.current[userId]) {
        const videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.className = 'remote-video';
        remoteVideoRefs.current[userId] = videoElement;
        document.getElementById('remoteVideos').appendChild(videoElement);
      }
      remoteVideoRefs.current[userId].srcObject = stream;
    });

    peer.on('error', err => {
      console.error('Peer error:', err);
      removePeer(userId);
    });

    if (signal) {
      peer.signal(JSON.parse(signal));
    }

    peersRef.current[userId] = peer;
  };

  const removePeer = (userId) => {
    if (peersRef.current[userId]) {
      peersRef.current[userId].destroy();
      delete peersRef.current[userId];
    }
    if (remoteVideoRefs.current[userId]) {
      remoteVideoRefs.current[userId].remove();
      delete remoteVideoRefs.current[userId];
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;

    const setupMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        localStreamRef.current = stream;
        localVideoRef.current.srcObject = stream;
      } catch (err) {
        console.error('Media error:', err);
      }
    };

    setupMedia();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      Object.keys(peersRef.current).forEach(removePeer);
    };
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <div className="auth-container">
        <h2>Присоединиться к комнате</h2>
        <form onSubmit={handleLogin}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Ваше имя"
            required
          />
          <input
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="ID комнаты"
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
    <div className="room-container">
      <div className="video-grid">
        <div className="video-tile local">
          <video ref={localVideoRef} autoPlay muted playsInline />
          <div className="video-info">{username} (Вы)</div>
        </div>
        
        {isScreenSharing && (
          <div className="video-tile screen">
            <video ref={screenVideoRef} autoPlay playsInline />
            <div className="video-info">Демонстрация экрана</div>
          </div>
        )}

        <div id="remoteVideos" className="remote-videos-container"></div>
      </div>

      <div className="controls">
        <button onClick={toggleMute} className={isMuted ? 'active' : ''}>
          {isMuted ? '🔇' : '🎤'}
        </button>
        <button onClick={toggleVideo} className={isVideoOff ? 'active' : ''}>
          {isVideoOff ? '📷 Off' : '📷 On'}
        </button>
        <button onClick={toggleScreenShare} className={isScreenSharing ? 'active' : ''}>
          {isScreenSharing ? '🖥️ Stop' : '🖥️ Share'}
        </button>
      </div>

      <div className="participants-list">
        <h3>Участники ({participants.length + 1})</h3>
        <ul>
          <li>{username} (Вы)</li>
          {participants.map(p => (
            <li key={p.id}>{p.name}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default App;