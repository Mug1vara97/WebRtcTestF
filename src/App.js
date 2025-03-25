import React, { useEffect, useRef, useState } from 'react';
import { HubConnectionBuilder } from '@microsoft/signalr';
import SimplePeer from 'simple-peer';

const App = () => {
  const [username, setUsername] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [otherUsers, setOtherUsers] = useState([]);
  const peerRef = useRef(null);
  const connectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const roomId = "1"; // Статичный ID комнаты

  // Авторизация
  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
      setIsAuthenticated(true);
    }
  };

  // 1. Подключение к комнате после авторизации
  useEffect(() => {
    if (!isAuthenticated) return;

    const connectToRoom = async () => {
      const connection = new HubConnectionBuilder()
        .withUrl("http://localhost:5070/webrtchub")
        .withAutomaticReconnect()
        .build();

      try {
        await connection.start();
        console.log("SignalR connection established");
        
        // Регистрируем обработчики событий
        connection.on("UserJoined", (newUserId) => {
          console.log("User joined:", newUserId);
          setOtherUsers(prev => [...prev, newUserId]);
          if (localStreamRef.current) {
            initiateCall(newUserId, localStreamRef.current);
          }
        });

        connection.on("UserLeft", (leftUserId) => {
          console.log("User left:", leftUserId);
          setOtherUsers(prev => prev.filter(id => id !== leftUserId));
        });

        connection.on("ReceiveSignal", (senderId, signal) => {
          console.log("Signal received from:", senderId);
          peerRef.current?.signal(JSON.parse(signal));
        });

        await connection.invoke("JoinRoom", roomId, username)
        .catch(err => console.error("Failed to join room:", err));
        
      } catch (err) {
        console.error("Connection error:", err);
      }
    };

    connectToRoom();

    return () => {
      connectionRef.current?.stop();
      peerRef.current?.destroy();
    };
  }, [isAuthenticated, username]);

  // 2. Получение медиапотока после входа в комнату
  useEffect(() => {
    if (!isAuthenticated) return;

    const getMediaStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        // Инициируем звонки с существующими пользователями
        otherUsers.forEach(userId => {
          initiateCall(userId, stream);
        });
        
      } catch (err) {
        console.error("Failed to get media stream:", err);
      }
    };

    getMediaStream();
  }, [isAuthenticated, otherUsers]);

  // Функция инициализации звонка
  const initiateCall = (targetUserId, localStream) => {
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.109.73.198.135:3478' }
    ];

    const peer = new SimplePeer({
      initiator: true,
      stream: localStream,
      config: { iceServers },
      trickle: false
    });

    peer.on('signal', data => {
      console.log("Sending signal to", targetUserId);
      connectionRef.current?.invoke("SendSignal", targetUserId, JSON.stringify(data));
    });

    peer.on('stream', remoteStream => {
      console.log("Received remote stream from", targetUserId);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    });

    peer.on('error', err => {
      console.error("WebRTC error with", targetUserId, ":", err);
    });

    peerRef.current = peer;
  };

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
          <button type="submit">Войти</button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Комната #{roomId}</h2>
      <p>Вы: {username}</p>
      <p>Участники: {otherUsers.length ? otherUsers.join(', ') : 'нет других участников'}</p>
      
      <div style={{ display: 'flex', gap: '20px', marginTop: '20px' }}>
        <video 
          ref={localVideoRef} 
          autoPlay 
          muted 
          playsInline 
          style={{ width: '300px', border: '1px solid #ccc' }}
        />
        <video 
          ref={remoteVideoRef} 
          autoPlay 
          playsInline 
          style={{ width: '300px', border: '1px solid #ccc' }}
        />
      </div>
    </div>
  );
};

export default App;