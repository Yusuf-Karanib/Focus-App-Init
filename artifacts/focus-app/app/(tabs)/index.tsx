import React, { useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";

const BLOCKED_APPS = [
  { name: "Instagram", icon: "instagram" as const },
  { name: "Twitter / X", icon: "twitter" as const },
  { name: "Facebook", icon: "facebook" as const },
  { name: "TikTok", icon: "music" as const },
  { name: "Snapchat", icon: "camera" as const },
  { name: "Reddit", icon: "hash" as const },
  { name: "YouTube", icon: "youtube" as const },
];

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const c = isDark ? dark : light;

  const [isEnabled, setIsEnabled] = useState(false);
  const [scale] = useState(new Animated.Value(1));

  function handleToggle(value: boolean) {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();

    if (Platform.OS !== "web") {
      Haptics.impactAsync(
        value ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
      );
    }

    setIsEnabled(value);
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: c.bg }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: topPad + 24,
          paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24),
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.appName, { color: c.text }]}>FocusApp</Text>
        <Text style={[styles.tagline, { color: c.muted }]}>
          Block distracting apps during focus sessions
        </Text>
      </View>

      {/* Status card */}
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPress={() => handleToggle(!isEnabled)}
          style={[
            styles.card,
            {
              backgroundColor: isEnabled ? c.primaryBg : c.cardBg,
              borderColor: isEnabled ? c.primaryBorder : c.border,
            },
          ]}
          accessibilityRole="switch"
          accessibilityState={{ checked: isEnabled }}
          accessibilityLabel="Focus mode toggle"
        >
          {/* Icon */}
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: isEnabled ? c.iconBgActive : c.iconBg },
            ]}
          >
            <Feather
              name={isEnabled ? "shield" : "shield-off"}
              size={28}
              color={isEnabled ? c.primaryIcon : c.muted}
            />
          </View>

          {/* Label */}
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, { color: c.text }]}>
              {isEnabled ? "Focus mode is ON" : "Focus mode is OFF"}
            </Text>
            <Text style={[styles.cardSub, { color: c.muted }]}>
              {isEnabled
                ? `Blocking ${BLOCKED_APPS.length} apps`
                : "Tap to start a focus session"}
            </Text>
          </View>

          {/* Switch */}
          <Switch
            value={isEnabled}
            onValueChange={handleToggle}
            trackColor={{ false: c.switchTrackOff, true: c.primary }}
            thumbColor="#ffffff"
            ios_backgroundColor={c.switchTrackOff}
            style={styles.switch}
          />
        </Pressable>
      </Animated.View>

      {/* Blocked apps list */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: c.muted }]}>BLOCKED APPS</Text>
        <View style={[styles.listCard, { backgroundColor: c.cardBg, borderColor: c.border }]}>
          {BLOCKED_APPS.map((app, i) => (
            <View key={app.name}>
              <View style={styles.row}>
                <View style={[styles.appIcon, { backgroundColor: c.iconBg }]}>
                  <Feather name={app.icon} size={16} color={c.muted} />
                </View>
                <Text style={[styles.appName2, { color: c.text }]}>{app.name}</Text>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: isEnabled ? c.primaryBg : c.iconBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      { color: isEnabled ? c.primaryIcon : c.muted },
                    ]}
                  >
                    {isEnabled ? "Blocked" : "Allowed"}
                  </Text>
                </View>
              </View>
              {i < BLOCKED_APPS.length - 1 && (
                <View style={[styles.divider, { backgroundColor: c.border }]} />
              )}
            </View>
          ))}
        </View>
      </View>

      {/* Footer note */}
      <View style={styles.footer}>
        <Feather name="info" size={13} color={c.muted} />
        <Text style={[styles.footerText, { color: c.muted }]}>
          Requires Accessibility Service permission on Android
        </Text>
      </View>
    </ScrollView>
  );
}

/* ── Tokens ─────────────────────────────────────────────────────────────── */

const light = {
  bg: "#f8fafc",
  cardBg: "#ffffff",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  primary: "#3b82f6",
  primaryBg: "#eff6ff",
  primaryBorder: "#bfdbfe",
  primaryIcon: "#2563eb",
  iconBg: "#f1f5f9",
  iconBgActive: "#dbeafe",
  switchTrackOff: "#cbd5e1",
};

const dark = {
  bg: "#0f172a",
  cardBg: "#1e293b",
  text: "#f1f5f9",
  muted: "#94a3b8",
  border: "#334155",
  primary: "#3b82f6",
  primaryBg: "#1e3a5f",
  primaryBorder: "#1d4ed8",
  primaryIcon: "#60a5fa",
  iconBg: "#334155",
  iconBgActive: "#1e3a5f",
  switchTrackOff: "#475569",
};

/* ── Styles ─────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    gap: 20,
  },
  header: {
    gap: 4,
    marginBottom: 4,
  },
  appName: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 16,
    borderWidth: 1.5,
    gap: 14,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: {
    flex: 1,
    gap: 3,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  cardSub: {
    fontSize: 13,
  },
  switch: {
    transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }],
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    marginLeft: 4,
  },
  listCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  appIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  appName2: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 60,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 4,
  },
  footerText: {
    fontSize: 12,
  },
});
