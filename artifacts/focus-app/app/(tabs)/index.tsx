import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

export default function HomeScreen() {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.iconContainer, { backgroundColor: colors.accent }]}>
        <Text style={styles.icon}>◎</Text>
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>FocusApp</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Your blank canvas. Start building.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 32,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  icon: {
    fontSize: 40,
    color: "#3b82f6",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
});
