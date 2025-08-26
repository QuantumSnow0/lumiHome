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
} from "lucide-react-native";
import { StatusBar } from "expo-status-bar";

const WS_URL = "ws://192.168.0.200:81";

export default function LightControl() {
  const ws = useRef(null);
  const insets = useSafeAreaInsets();

  const [rooms, setRooms] = useState([
    { id: "relay1", name: "Kitchen", icon: ChefHat, isOn: false },
    { id: "relay2", name: "Corridor", icon: Home, isOn: false },
    { id: "relay3", name: "Bedroom", icon: Bed, isOn: false },
    { id: "relay4", name: "Sitting Room", icon: Sofa, isOn: false },
    { id: "relay5", name: "Outside Light", icon: TreePine, isOn: false },
  ]);

  const [connected, setConnected] = useState(false);
  const [blink, setBlink] = useState(false);
  const lastPongRef = useRef(Date.now());
  const reconnectRef = useRef({ attempt: 0, timeout: null });

  // Blink indicator
  useEffect(() => {
    const interval = setInterval(() => setBlink((b) => !b), 500);
    return () => clearInterval(interval);
  }, []);

  // Send JSON helper
  const sendJson = useCallback((obj) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(obj));
    } else {
      console.log("⚠️ WebSocket not open, ignoring:", obj);
    }
  }, []);

  // WebSocket connect
  const connectWebSocket = useCallback(() => {
    // Close previous socket if exists
    if (ws.current) {
      ws.current.onopen = null;
      ws.current.onmessage = null;
      ws.current.onclose = null;
      ws.current.onerror = null;
      ws.current.close();
      ws.current = null;
    }

    ws.current = new WebSocket(WS_URL);

    ws.current.onopen = () => {
      console.log("✅ Connected to ESP32");
      setConnected(true);
      reconnectRef.current.attempt = 0;
      sendJson({ action: "getState" });
    };

    ws.current.onmessage = (m) => {
      try {
        const data = JSON.parse(m.data);

        if (data.pong) {
          lastPongRef.current = Date.now();
          if (!connected) setConnected(true);
          return;
        }

        // Update room states from ESP32
        setRooms((prev) =>
          prev.map((room) =>
            data.hasOwnProperty(room.id)
              ? { ...room, isOn: !!data[room.id] }
              : room
          )
        );
      } catch (err) {
        console.log("⚠️ JSON parse error:", err);
      }
    };

    ws.current.onerror = (e) => console.log("❌ WebSocket error:", e.message);

    ws.current.onclose = () => {
      console.log("🔌 Disconnected from ESP32");
      setConnected(false);

      // schedule reconnection
      const attempt = reconnectRef.current.attempt;
      const delay = Math.min(30000, 1000 * 2 ** attempt);
      console.log(`🔄 Reconnecting in ${delay / 1000}s...`);

      if (reconnectRef.current.timeout)
        clearTimeout(reconnectRef.current.timeout);

      reconnectRef.current.timeout = setTimeout(() => {
        reconnectRef.current.attempt += 1;
        connectWebSocket();
      }, delay);
    };
  }, [connected, sendJson]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (ws.current) ws.current.close();
      if (reconnectRef.current.timeout)
        clearTimeout(reconnectRef.current.timeout);
    };
  }, [connectWebSocket]);

  // Heartbeat ping
  useEffect(() => {
    const interval = setInterval(() => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ ping: true }));
      } else {
        setConnected(false);
      }

      if (Date.now() - lastPongRef.current > 3000) {
        setConnected(false);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Toggle light
  const toggleLight = useCallback(
    (roomId, currentState) => {
      sendJson({ [roomId]: !currentState });
    },
    [sendJson]
  );

  const turnAllLightsOn = () => sendJson({ all: true });
  const turnAllLightsOff = () => sendJson({ all: false });

  const totalLightsOn = useMemo(
    () => rooms.filter((r) => r.isOn).length,
    [rooms]
  );

  const renderRoom = ({ item: room }) => {
    const IconComponent = room.icon;
    return (
      <TouchableOpacity
        style={[
          styles.card,
          { borderColor: room.isOn ? "#f87171" : "#334155" },
        ]}
        onPress={() => toggleLight(room.id, room.isOn)}
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
          <View
            style={[
              styles.statusBox,
              {
                backgroundColor: room.isOn
                  ? "rgba(248,113,113,0.1)"
                  : "#334155",
              },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                { backgroundColor: room.isOn ? "#f87171" : "#94a3b8" },
              ]}
            />
            <Text
              style={{ color: room.isOn ? "#f87171" : "#94a3b8", fontSize: 12 }}
            >
              {room.isOn ? "ON" : "OFF"}
            </Text>
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.row}>
            <Lightbulb size={16} color={room.isOn ? "#f87171" : "#94a3b8"} />
            <Text style={styles.lightText}>
              {room.isOn ? "Light is on" : "Light is off"}
            </Text>
          </View>
          <Switch
            value={room.isOn}
            onValueChange={() => toggleLight(room.id, room.isOn)}
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

        <View style={styles.statusChip}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: connected
                  ? blink
                    ? "#22c55e"
                    : "#334155"
                  : blink
                  ? "#ef4444"
                  : "#334155",
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
        contentContainerStyle={{ paddingBottom: 20 }}
      />

      <View style={styles.quickControls}>
        <Text style={styles.quickTitle}>Quick Controls</Text>
        <View style={styles.quickRow}>
          <TouchableOpacity style={styles.onButton} onPress={turnAllLightsOn}>
            <Lightbulb size={20} color="white" />
            <Text style={styles.btnText}>All Lights On</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.offButton} onPress={turnAllLightsOff}>
            <Lightbulb size={20} color="#94a3b8" />
            <Text style={styles.offBtnText}>All Lights Off</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// Styles remain unchanged
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", padding: 16 },
  header: { alignItems: "center", marginBottom: 20 },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 24, fontWeight: "bold", color: "white", marginLeft: 8 },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e293b",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { color: "white", fontSize: 12 },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
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
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  lightText: { color: "#94a3b8", marginLeft: 6, fontSize: 14 },
  quickControls: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  quickTitle: {
    color: "white",
    fontWeight: "600",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 12,
  },
  quickRow: { flexDirection: "row", justifyContent: "space-between" },
  onButton: {
    flex: 1,
    backgroundColor: "#f87171",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderRadius: 12,
    marginRight: 6,
  },
  offButton: {
    flex: 1,
    backgroundColor: "#334155",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderRadius: 12,
    marginLeft: 6,
  },
  btnText: { color: "white", fontWeight: "600", marginLeft: 6 },
  offBtnText: { color: "#94a3b8", fontWeight: "600", marginLeft: 6 },
});
