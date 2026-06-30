import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Path,
  Stop,
  Line,
  Circle,
} from "react-native-svg";
import { Image } from "expo-image";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, HistoryResponse } from "@/src/api";
import { theme } from "@/src/theme";

const CHART_W = 320;
const CHART_H = 160;
const CHART_PAD_X = 8;
const CHART_PAD_Y = 16;

function buildPath(
  points: { x: number; y: number }[],
  baseline: number,
  closed: boolean
) {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  if (closed) {
    d += ` L ${points[points.length - 1].x} ${baseline}`;
    d += ` L ${points[0].x} ${baseline} Z`;
  }
  return d;
}

const RANGE_OPTIONS = [
  { label: "24h", limit: 24 },
  { label: "7d", limit: 168 },
  { label: "30d", limit: 720 },
] as const;

type ChartModalProps = {
  open: boolean;
  onClose: () => void;
  league: string;
  c1Id: number;
  c2Id: number;
  c1Name: string;
  c2Name: string;
  c1Icon?: string | null;
  c2Icon?: string | null;
};

export default function PairHistoryChart(props: ChartModalProps) {
  const { open, onClose, league, c1Id, c2Id, c1Name, c2Name, c1Icon, c2Icon } = props;
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]>(RANGE_OPTIONS[1]);

  useEffect(() => {
    if (!open || !c1Id || !c2Id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.history({ league, c1_id: c1Id, c2_id: c2Id, limit: range.limit });
        if (!cancelled) setData(res);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, league, c1Id, c2Id, range]);

  const chart = useMemo(() => {
    if (!data || data.points.length < 2) return null;
    const pts = data.points;
    const ys = pts.map((p) => p.rate);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const yRange = yMax - yMin || 1;
    const xMin = pts[0].epoch;
    const xMax = pts[pts.length - 1].epoch;
    const xRange = xMax - xMin || 1;
    const W = CHART_W - CHART_PAD_X * 2;
    const H = CHART_H - CHART_PAD_Y * 2;
    const mapped = pts.map((p) => ({
      x: CHART_PAD_X + ((p.epoch - xMin) / xRange) * W,
      y: CHART_PAD_Y + (1 - (p.rate - yMin) / yRange) * H,
    }));
    const linePath = buildPath(mapped, CHART_H - CHART_PAD_Y, false);
    const areaPath = buildPath(mapped, CHART_H - CHART_PAD_Y, true);
    return { mapped, linePath, areaPath, yMin, yMax };
  }, [data]);

  const positive = (data?.change_pct ?? 0) >= 0;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="history-chart-modal">
          <SafeAreaView edges={["bottom"]} style={{ width: "100%" }}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>Price History</Text>
                  <View style={styles.pairRow}>
                    {c1Icon && <Image source={c1Icon} style={styles.icon} contentFit="contain" />}
                    <Text style={styles.pairName} numberOfLines={1}>
                      {c1Name}
                    </Text>
                    <Ionicons name="arrow-forward" size={12} color={theme.colors.gold} />
                    {c2Icon && <Image source={c2Icon} style={styles.icon} contentFit="contain" />}
                    <Text style={styles.pairName} numberOfLines={1}>
                      {c2Name}
                    </Text>
                  </View>
                </View>
                <Pressable testID="history-close" onPress={onClose} hitSlop={12} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color={theme.colors.text} />
                </Pressable>
              </View>

              <View style={styles.rangeRow}>
                {RANGE_OPTIONS.map((r) => {
                  const active = range.label === r.label;
                  return (
                    <Pressable
                      key={r.label}
                      testID={`range-${r.label}`}
                      onPress={() => setRange(r)}
                      style={[styles.rangeChip, active && styles.rangeChipActive]}
                    >
                      <Text
                        style={[
                          styles.rangeChipText,
                          active && { color: theme.colors.gold },
                        ]}
                      >
                        {r.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {loading && (
                <View style={styles.center} testID="history-loading">
                  <ActivityIndicator color={theme.colors.gold} />
                </View>
              )}
              {error && (
                <View style={styles.errorBox}>
                  <Ionicons name="warning" size={14} color={theme.colors.crimsonGlow} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {data && !loading && (
                <>
                  <View style={styles.statsRow}>
                    <View style={styles.statCell}>
                      <Text style={styles.statLabel}>LATEST</Text>
                      <Text style={styles.statValue}>{data.latest.toFixed(4)}</Text>
                    </View>
                    <View style={styles.statCell}>
                      <Text style={styles.statLabel}>CHANGE</Text>
                      <Text
                        style={[
                          styles.statValue,
                          { color: positive ? theme.colors.success : theme.colors.crimsonGlow },
                        ]}
                      >
                        {positive ? "+" : ""}
                        {data.change_pct.toFixed(2)}%
                      </Text>
                    </View>
                    <View style={styles.statCell}>
                      <Text style={styles.statLabel}>HIGH</Text>
                      <Text style={styles.statValue}>{data.high.toFixed(4)}</Text>
                    </View>
                    <View style={styles.statCell}>
                      <Text style={styles.statLabel}>LOW</Text>
                      <Text style={styles.statValue}>{data.low.toFixed(4)}</Text>
                    </View>
                  </View>

                  {chart ? (
                    <View style={styles.chartWrap} testID="history-chart">
                      <Svg width={CHART_W} height={CHART_H}>
                        <Defs>
                          <SvgLinearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                            <Stop offset="0" stopColor={theme.colors.gold} stopOpacity="0.45" />
                            <Stop offset="1" stopColor={theme.colors.gold} stopOpacity="0" />
                          </SvgLinearGradient>
                        </Defs>
                        {/* Gridlines */}
                        {[0, 0.25, 0.5, 0.75, 1].map((g) => {
                          const y = CHART_PAD_Y + g * (CHART_H - CHART_PAD_Y * 2);
                          return (
                            <Line
                              key={g}
                              x1={CHART_PAD_X}
                              x2={CHART_W - CHART_PAD_X}
                              y1={y}
                              y2={y}
                              stroke={theme.colors.border}
                              strokeWidth={0.5}
                              strokeDasharray="2 3"
                            />
                          );
                        })}
                        <Path d={chart.areaPath} fill="url(#grad)" />
                        <Path
                          d={chart.linePath}
                          stroke={theme.colors.goldBright}
                          strokeWidth={2}
                          fill="none"
                        />
                        {chart.mapped.length > 0 && (
                          <Circle
                            cx={chart.mapped[chart.mapped.length - 1].x}
                            cy={chart.mapped[chart.mapped.length - 1].y}
                            r={4}
                            fill={theme.colors.goldBright}
                          />
                        )}
                      </Svg>
                      <View style={styles.yScale}>
                        <Text style={styles.scaleText}>{chart.yMax.toFixed(3)}</Text>
                        <Text style={styles.scaleText}>{chart.yMin.toFixed(3)}</Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.center} testID="history-empty">
                      <MaterialCommunityIcons
                        name="chart-line-variant"
                        size={36}
                        color={theme.colors.textMuted}
                      />
                      <Text style={styles.emptyText}>
                        Not enough history for this pair yet.
                      </Text>
                    </View>
                  )}

                  <Text style={styles.hint}>
                    Shows 1 {c1Name} → x {c2Name} over time.
                  </Text>
                </>
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: theme.colors.overlay, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.colors.bgElev,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: theme.spacing.sm,
  },
  title: {
    color: theme.colors.gold,
    fontSize: theme.font.h2,
    fontWeight: "800",
  },
  pairRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  pairName: {
    color: theme.colors.text,
    fontSize: theme.font.small,
    maxWidth: 110,
  },
  icon: { width: 16, height: 16 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.bgCard,
    justifyContent: "center",
    alignItems: "center",
  },
  rangeRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: theme.spacing.sm,
  },
  rangeChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: theme.colors.bgCard,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
  },
  rangeChipActive: {
    borderColor: theme.colors.gold,
    backgroundColor: "#2a1d0a",
  },
  rangeChipText: {
    color: theme.colors.textDim,
    fontWeight: "700",
    fontSize: theme.font.small,
  },
  statsRow: {
    flexDirection: "row",
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  statCell: { flex: 1, alignItems: "center" },
  statLabel: {
    color: theme.colors.textDim,
    fontSize: theme.font.micro,
    letterSpacing: 1,
    fontWeight: "700",
  },
  statValue: {
    color: theme.colors.text,
    fontSize: theme.font.body,
    fontWeight: "800",
    marginTop: 2,
  },
  chartWrap: {
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  yScale: {
    height: CHART_H - CHART_PAD_Y * 2,
    justifyContent: "space-between",
    marginLeft: 4,
  },
  scaleText: { color: theme.colors.textDim, fontSize: theme.font.micro },
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  emptyText: {
    color: theme.colors.textDim,
    fontSize: theme.font.small,
    textAlign: "center",
  },
  errorBox: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: "#3a1414",
    borderColor: theme.colors.crimson,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
  },
  errorText: { color: theme.colors.crimsonGlow, fontSize: theme.font.small, flex: 1 },
  hint: {
    color: theme.colors.textDim,
    fontSize: theme.font.micro,
    textAlign: "center",
    marginTop: theme.spacing.sm,
  },
});
