import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Lightbulb,
  Home,
  Bed,
  ChefHat,
  Sofa,
  TreePine,
  Clock,
} from "lucide-react-native";
import { StatusBar } from "expo-status-bar";

const WS_URL = "ws://192.168.0.200:81"; // match ESP static IP
const AUTO_OFF_SEC = 3600; // 🔥 one hour = 3600s

export default function LightControl() {
  const ws = useRef(null);
  const insets = useSafeAreaInsets();

  const [rooms, setRooms] = useState([
    {
      id: "relay1",
      name: "Kitchen",
      icon: ChefHat,
      isOn: false,
      time: 0,
      countdown: null,
    },
    {
      id: "relay2",
      name: "Corridor",
      icon: Home,
      isOn: false,
      time: 0,
      countdown: null,
    },
    {
      id: "relay3",
      name: "Bedroom",
      icon: Bed,
      isOn: false,
      time: 0,
      countdown: null,
    },
    {
      id: "relay4",
      name: "Sitting Room",
      icon: Sofa,
      isOn: false,
      time: 0,
      countdown: null,
    },
    {
      id: "relay5",
      name: "Outside Light",
      icon: TreePine,
      isOn: false,
      time: 0,
      countdown: null,
    },
  ]);

  const [connected, setConnected] = useState(false);
  const [dotVisible, setDotVisible] = useState(true);

  // stable refs
  const lastPongRef = useRef(Date.now());
  const reconnectRef = useRef({ attempt: 0, timeout: null });
  const sendQueueRef = useRef([]);
  const countdownRefs = useRef({}); // timers for countdowns

  // 🔴🟢 blinking dot effect
  useEffect(() => {
    const iv = setInterval(() => {
      setDotVisible((prev) => !prev);
    }, 600);
    return () => clearInterval(iv);
  }, []);

  // tick ON-time
  useEffect(() => {
    const iv = setInterval(() => {
      setRooms((prev) =>
        prev.map((r) => (r.isOn ? { ...r, time: r.time + 1 } : r))
      );
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // safe send
  const sendJson = useCallback((obj) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(obj));
    } else {
      sendQueueRef.current.push(obj);
    }
  }, []);

  const flushQueue = useCallback(() => {
    if (
      ws.current?.readyState === WebSocket.OPEN &&
      sendQueueRef.current.length
    ) {
      const q = sendQueueRef.current.splice(0);
      q.forEach((obj) => ws.current.send(JSON.stringify(obj)));
    }
  }, []);

  // start or reset countdown
  const startCountdown = useCallback(
    (roomId, seconds = AUTO_OFF_SEC) => {
      if (countdownRefs.current[roomId]) {
        clearInterval(countdownRefs.current[roomId]);
      }
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, countdown: seconds } : r))
      );

      countdownRefs.current[roomId] = setInterval(() => {
        setRooms((prev) =>
          prev.map((r) => {
            if (r.id === roomId && r.countdown !== null) {
              if (r.countdown <= 1) {
                clearInterval(countdownRefs.current[roomId]);
                delete countdownRefs.current[roomId];
                sendJson({ [roomId]: false }); // auto turn off
                return { ...r, isOn: false, countdown: null };
              }
              return { ...r, countdown: r.countdown - 1 };
            }
            return r;
          })
        );
      }, 1000);
    },
    [sendJson]
  );

  const cancelCountdown = useCallback((roomId) => {
    if (countdownRefs.current[roomId]) {
      clearInterval(countdownRefs.current[roomId]);
      delete countdownRefs.current[roomId];
    }
    setRooms((prev) =>
      prev.map((r) => (r.id === roomId ? { ...r, countdown: null } : r))
    );
  }, []);

  // websocket connect
  const connectWebSocket = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;
    if (ws.current) {
      try {
        ws.current.close();
      } catch {}
      ws.current = null;
    }

    ws.current = new WebSocket(WS_URL);

    ws.current.onopen = () => {
      setConnected(true);
      reconnectRef.current.attempt = 0;
      sendJson({ action: "getState" });
      flushQueue();
    };

    ws.current.onmessage = (m) => {
      try {
        const data = JSON.parse(m.data);
        if (data.pong) {
          lastPongRef.current = Date.now();
          return;
        }
        setRooms((prev) =>
          prev.map((room) => {
            const timeKey = `${room.id}_time`;
            let updated = {
              ...room,
              isOn: data.hasOwnProperty(room.id) ? !!data[room.id] : room.isOn,
              time: data.hasOwnProperty(timeKey) ? data[timeKey] : room.time,
            };
            if (updated.isOn && updated.countdown === null) {
              startCountdown(room.id, AUTO_OFF_SEC);
            }
            if (!updated.isOn && updated.countdown !== null) {
              cancelCountdown(room.id);
            }
            return updated;
          })
        );
      } catch {}
    };

    ws.current.onclose = () => {
      setConnected(false);
      const attempt = reconnectRef.current.attempt || 0;
      const delay = Math.min(30000, 1000 * 2 ** attempt);
      reconnectRef.current.timeout = setTimeout(() => {
        reconnectRef.current.attempt = Math.min(30, attempt + 1);
        connectWebSocket();
      }, delay);
    };
  }, [flushQueue, sendJson, startCountdown, cancelCountdown]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (ws.current)
        try {
          ws.current.close();
        } catch {}
      if (reconnectRef.current.timeout)
        clearTimeout(reconnectRef.current.timeout);
      Object.values(countdownRefs.current).forEach(clearInterval);
    };
  }, [connectWebSocket]);

  // heartbeat
  useEffect(() => {
    const iv = setInterval(() => {
      try {
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ ping: true }));
        }
      } catch {}
      if (Date.now() - lastPongRef.current > 15000) {
        if (ws.current)
          try {
            ws.current.close();
          } catch {}
        setConnected(false);
      }
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  // toggle individual
  const toggleLight = useCallback(
    (roomId, currentState) => {
      if (!connected) return;
      const newState = !currentState;
      if (newState) {
        startCountdown(roomId, AUTO_OFF_SEC);
        sendJson({ [roomId]: true, auto_off_sec: AUTO_OFF_SEC });
      } else {
        cancelCountdown(roomId);
        sendJson({ [roomId]: false });
      }
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, isOn: newState } : r))
      );
    },
    [sendJson, startCountdown, cancelCountdown, connected]
  );

  // all on/off
  const turnAllLightsOn = () => {
    if (!connected) return;
    setRooms((prev) => prev.map((r) => ({ ...r, isOn: true })));
    rooms.forEach((r) => startCountdown(r.id, AUTO_OFF_SEC));
    sendJson({ all: true, auto_off_sec: AUTO_OFF_SEC });
  };

  const turnAllLightsOff = () => {
    if (!connected) return;
    setRooms((prev) =>
      prev.map((r) => ({ ...r, isOn: false, countdown: null }))
    );
    Object.keys(countdownRefs.current).forEach(cancelCountdown);
    sendJson({ all: false });
  };

  const totalLightsOn = useMemo(
    () => rooms.filter((r) => r.isOn).length,
    [rooms]
  );

  const formatTime = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h.toString().padStart(2, "0")}:${m
      .toString()
      .padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const renderRoom = ({ item: room }) => {
    const IconComponent = room.icon;
    return (
      <TouchableOpacity
        style={[
          styles.card,
          { borderColor: room.isOn ? "#f87171" : "#334155" },
          !connected && { opacity: 0.4 },
        ]}
        onPress={() => toggleLight(room.id, room.isOn)}
        disabled={!connected}
      >
        <View style={styles.cardHeader}>
          <View style={styles.roomInfo}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: room.isOn ? "#f87171" : "#334155" },
              ]}
            >
              <IconComponent
                size={20}
                color={room.isOn ? "white" : "#94a3b8"}
              />
            </View>
            <Text style={styles.roomName}>{room.name}</Text>
          </View>
          <Text
            style={{ color: room.isOn ? "#f87171" : "#94a3b8", fontSize: 12 }}
          >
            {room.isOn ? "ON" : "OFF"}
          </Text>
        </View>

        <View style={styles.row}>
          <View style={styles.row}>
            <Clock size={16} color="#94a3b8" />
            <Text style={styles.lightText}>{formatTime(room.time)}</Text>
          </View>
          {room.countdown !== null && (
            <Text style={styles.countdown}>
              Auto-off in {formatTime(room.countdown)}
            </Text>
          )}
          <Switch
            value={room.isOn}
            onValueChange={() => toggleLight(room.id, room.isOn)}
            disabled={!connected}
          />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Lightbulb size={32} color="#f87171" />
          <Text style={styles.title}>Smart Home Lighting</Text>
        </View>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.dot,
              {
                backgroundColor: connected ? "green" : "red",
                opacity: dotVisible ? 1 : 0.2,
              },
            ]}
          />
          <Text style={styles.statusText}>
            {totalLightsOn} of {rooms.length} lights on
          </Text>
        </View>
      </View>
      <FlatList
        data={rooms}
        keyExtractor={(item) => item.id}
        renderItem={renderRoom}
      />
      <View style={styles.quickControls}>
        <TouchableOpacity
          style={[styles.onButton, !connected && { opacity: 0.4 }]}
          onPress={turnAllLightsOn}
          disabled={!connected}
        >
          <Text style={styles.btnText}>All Lights On (1h)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.offButton, !connected && { opacity: 0.4 }]}
          onPress={turnAllLightsOff}
          disabled={!connected}
        >
          <Text style={styles.offBtnText}>All Lights Off</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", padding: 16 },
  header: { alignItems: "center", marginBottom: 20 },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 22, fontWeight: "bold", color: "white", marginLeft: 8 },
  statusRow: { flexDirection: "row", alignItems: "center" },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  statusText: { color: "white", fontSize: 14 },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  roomInfo: { flexDirection: "row", alignItems: "center" },
  iconBox: { padding: 6, borderRadius: 8 },
  roomName: { fontSize: 16, fontWeight: "600", color: "white", marginLeft: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  lightText: { color: "#94a3b8", marginLeft: 6, fontSize: 14 },
  countdown: { color: "#f87171", fontSize: 12, marginLeft: 10 },
  quickControls: {
    flexDirection: "row",
    marginTop: 16,
    justifyContent: "space-between",
  },
  onButton: {
    flex: 1,
    backgroundColor: "#f87171",
    padding: 12,
    borderRadius: 12,
    marginRight: 6,
  },
  offButton: {
    flex: 1,
    backgroundColor: "#334155",
    padding: 12,
    borderRadius: 12,
    marginLeft: 6,
  },
  btnText: { color: "white", fontWeight: "600", textAlign: "center" },
  offBtnText: { color: "#94a3b8", fontWeight: "600", textAlign: "center" },
});
