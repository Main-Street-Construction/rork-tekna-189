import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
  Platform,
} from 'react-native';
import {
  PanGestureHandler,
  PinchGestureHandler,
  State,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
  type PinchGestureHandlerGestureEvent,
  type PinchGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';
import Svg, { Line, Path } from 'react-native-svg';
import { Plus, Minus, Crosshair, Expand } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import type { FamilyTreeData, GedcomIndividual } from '@/types/genealogy';
import {
  TREE_MAX_NODES,
  TREE_NODE_HEIGHT,
  TREE_NODE_WIDTH,
  cullEdgesForNodes,
  cullNodesToViewport,
  expandPersonNeighborhood,
  layoutTreeCanvas,
  seedRevealedIds,
  type TreeCanvasLayout,
  type TreeCanvasNode,
} from '@/utils/tree-canvas-layout';

const MIN_SCALE = 0.35;
const MAX_SCALE = 2.4;

function sexColor(sex: GedcomIndividual['sex']): string {
  if (sex === 'F') return Colors.female;
  if (sex === 'M') return Colors.male;
  return Colors.textSecondary;
}

function initialsOf(person: GedcomIndividual): string {
  return `${person.givenName?.[0] ?? ''}${person.surname?.[0] ?? ''}`;
}

interface TreeExplorerCanvasProps {
  focusId: string;
  data: FamilyTreeData;
  onOpenPerson: (person: GedcomIndividual) => void;
}

export default function TreeExplorerCanvas({
  focusId,
  data,
  onOpenPerson,
}: TreeExplorerCanvasProps) {
  const [revealed, setRevealed] = useState(() => seedRevealedIds(focusId, data));
  const [viewportTick, setViewportTick] = useState(0);

  const screen = Dimensions.get('window');
  const [canvasSize, setCanvasSize] = useState({ width: screen.width, height: screen.height });

  const panRef = useRef<PanGestureHandler>(null);
  const pinchRef = useRef<PinchGestureHandler>(null);

  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const panOffset = useRef({ x: 0, y: 0 });
  const pinchBase = useRef(1);
  const lastTapRef = useRef<{ id: string; at: number } | null>(null);

  const bumpViewport = useCallback(() => {
    setViewportTick((t) => t + 1);
  }, []);

  // Light periodic cull refresh while gestures move transform without React state.
  useEffect(() => {
    const id = setInterval(bumpViewport, 180);
    return () => clearInterval(id);
  }, [bumpViewport]);

  // Reset neighborhood/camera when the focus person changes — not on every tree sync,
  // so background refreshes don't wipe an in-progress exploration.
  useEffect(() => {
    setRevealed(seedRevealedIds(focusId, data));
    panOffset.current = { x: 0, y: 0 };
    pinchBase.current = 1;
    transformRef.current = { x: 0, y: 0, scale: 1 };
    translateX.setValue(0);
    translateY.setValue(0);
    scale.setValue(1);
    bumpViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed on focus change
  }, [focusId]);

  const layout: TreeCanvasLayout = useMemo(
    () => layoutTreeCanvas(focusId, data, revealed),
    [focusId, data, revealed]
  );

  const resolvedViewport = useMemo(() => {
    void viewportTick;
    const { x, y, scale: s } = transformRef.current;
    const safeS = s || 1;
    const cx = canvasSize.width / 2;
    const cy = canvasSize.height / 2;
    return {
      left: (0 - x - cx) / safeS,
      right: (canvasSize.width - x - cx) / safeS,
      top: (0 - y - cy) / safeS,
      bottom: (canvasSize.height - y - cy) / safeS,
    };
  }, [viewportTick, canvasSize]);

  const visibleNodes = useMemo(
    () => cullNodesToViewport(layout.nodes, resolvedViewport, TREE_MAX_NODES),
    [layout.nodes, resolvedViewport]
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => cullEdgesForNodes(layout.edges, visibleIds),
    [layout.edges, visibleIds]
  );

  const posById = useMemo(() => {
    const m = new Map<string, TreeCanvasNode>();
    for (const n of layout.nodes) m.set(n.id, n);
    return m;
  }, [layout.nodes]);

  const centerOnFocus = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    panOffset.current = { x: 0, y: 0 };
    pinchBase.current = 1;
    Animated.parallel([
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8 }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 8 }),
    ]).start(() => {
      transformRef.current = { x: 0, y: 0, scale: 1 };
      bumpViewport();
    });
  }, [translateX, translateY, scale, bumpViewport]);

  const zoomBy = useCallback(
    (factor: number) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchBase.current * factor));
      pinchBase.current = next;
      Animated.spring(scale, { toValue: next, useNativeDriver: true, friction: 8 }).start(() => {
        transformRef.current.scale = next;
        bumpViewport();
      });
    },
    [scale, bumpViewport]
  );

  const handlePanEvent = useCallback(
    (e: PanGestureHandlerGestureEvent) => {
      const { translationX: tx, translationY: ty } = e.nativeEvent;
      const nx = panOffset.current.x + tx;
      const ny = panOffset.current.y + ty;
      translateX.setValue(nx);
      translateY.setValue(ny);
      transformRef.current.x = nx;
      transformRef.current.y = ny;
    },
    [translateX, translateY]
  );

  const handlePanStateChange = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      if (e.nativeEvent.oldState === State.ACTIVE) {
        panOffset.current.x += e.nativeEvent.translationX;
        panOffset.current.y += e.nativeEvent.translationY;
        transformRef.current.x = panOffset.current.x;
        transformRef.current.y = panOffset.current.y;
        bumpViewport();
      }
    },
    [bumpViewport]
  );

  const handlePinchEvent = useCallback(
    (e: PinchGestureHandlerGestureEvent) => {
      const next = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, pinchBase.current * e.nativeEvent.scale)
      );
      scale.setValue(next);
      transformRef.current.scale = next;
    },
    [scale]
  );

  const handlePinchStateChange = useCallback(
    (e: PinchGestureHandlerStateChangeEvent) => {
      if (e.nativeEvent.oldState === State.ACTIVE) {
        pinchBase.current = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, pinchBase.current * e.nativeEvent.scale)
        );
        transformRef.current.scale = pinchBase.current;
        scale.setValue(pinchBase.current);
        bumpViewport();
      }
    },
    [scale, bumpViewport]
  );

  const expandNode = useCallback(
    (node: TreeCanvasNode) => {
      if (!node.canExpand) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setRevealed((prev) => expandPersonNeighborhood(node.id, data, prev, TREE_MAX_NODES));
    },
    [data]
  );

  const handleNodePress = useCallback(
    (node: TreeCanvasNode) => {
      const now = Date.now();
      const last = lastTapRef.current;
      if (last && last.id === node.id && now - last.at < 320) {
        lastTapRef.current = null;
        onOpenPerson(node.person);
        return;
      }
      lastTapRef.current = { id: node.id, at: now };
      if (node.canExpand) {
        expandNode(node);
      } else {
        void Haptics.selectionAsync();
        onOpenPerson(node.person);
      }
    },
    [expandNode, onOpenPerson]
  );

  const svgMinX = layout.bounds.minX - 40;
  const svgMinY = layout.bounds.minY - 40;
  const svgW = Math.max(1, layout.bounds.maxX - layout.bounds.minX + 80);
  const svgH = Math.max(1, layout.bounds.maxY - layout.bounds.minY + 80);
  const expandableCount = layout.nodes.reduce((n, node) => n + (node.canExpand ? 1 : 0), 0);

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) setCanvasSize({ width, height });
      }}
    >
      <PinchGestureHandler
        ref={pinchRef}
        onGestureEvent={handlePinchEvent}
        onHandlerStateChange={handlePinchStateChange}
        simultaneousHandlers={panRef}
      >
        <Animated.View style={styles.flex}>
          <PanGestureHandler
            ref={panRef}
            onGestureEvent={handlePanEvent}
            onHandlerStateChange={handlePanStateChange}
            simultaneousHandlers={pinchRef}
            minPointers={1}
            maxPointers={2}
            avgTouches
          >
            <Animated.View style={styles.flex} collapsable={false}>
              <Animated.View
                style={[
                  styles.world,
                  {
                    transform: [
                      { translateX: canvasSize.width / 2 },
                      { translateY: canvasSize.height / 2 },
                      { translateX },
                      { translateY },
                      { scale },
                    ],
                  },
                ]}
              >
                <Svg
                  width={svgW}
                  height={svgH}
                  style={{
                    position: 'absolute',
                    left: svgMinX,
                    top: svgMinY,
                  }}
                  pointerEvents="none"
                >
                  {visibleEdges.map((edge) => {
                    const a = posById.get(edge.fromId);
                    const b = posById.get(edge.toId);
                    if (!a || !b) return null;
                    const x1 = a.x - svgMinX;
                    const y1 = a.y - svgMinY;
                    const x2 = b.x - svgMinX;
                    const y2 = b.y - svgMinY;
                    if (edge.kind === 'spouse') {
                      return (
                        <Line
                          key={edge.id}
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke={Colors.accentLight}
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                      );
                    }
                    const midY = (y1 + y2) / 2;
                    const d = `M ${x1} ${y1 + 28} V ${midY} H ${x2} V ${y2 - 28}`;
                    return (
                      <Path
                        key={edge.id}
                        d={d}
                        stroke={Colors.cardBorder}
                        strokeWidth={1.5}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })}
                </Svg>

                {visibleNodes.map((node) => (
                  <TreeNodeView key={node.id} node={node} onPress={handleNodePress} />
                ))}
              </Animated.View>
            </Animated.View>
          </PanGestureHandler>
        </Animated.View>
      </PinchGestureHandler>

      <View style={styles.hud} pointerEvents="box-none">
        <View style={styles.hintPill}>
          <Text style={styles.hintText}>
            Drag to pan · pinch zoom · tap gold dot to expand · double-tap opens profile
          </Text>
        </View>

        <View style={styles.controls}>
          <HudButton icon={<Plus size={18} color={Colors.text} />} onPress={() => zoomBy(1.2)} label="Zoom in" />
          <HudButton icon={<Minus size={18} color={Colors.text} />} onPress={() => zoomBy(1 / 1.2)} label="Zoom out" />
          <HudButton icon={<Crosshair size={18} color={Colors.text} />} onPress={centerOnFocus} label="Center" />
        </View>

        <View style={styles.statsPill}>
          <Expand size={12} color={Colors.textSecondary} />
          <Text style={styles.statsText}>
            {layout.nodes.length} people
            {expandableCount > 0 ? ` · ${expandableCount} expandable` : ' · fully expanded nearby'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function HudButton({
  icon,
  onPress,
  label,
}: {
  icon: React.ReactNode;
  onPress: () => void;
  label: string;
}) {
  return (
    <TouchableOpacity
      style={styles.hudBtn}
      onPress={onPress}
      accessibilityLabel={label}
      activeOpacity={0.75}
    >
      {icon}
    </TouchableOpacity>
  );
}

const TreeNodeView = React.memo(function TreeNodeView({
  node,
  onPress,
}: {
  node: TreeCanvasNode;
  onPress: (node: TreeCanvasNode) => void;
}) {
  const color = sexColor(node.person.sex);
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onPress(node)}
      style={[
        styles.node,
        node.isFocus && styles.nodeFocus,
        {
          left: node.x - TREE_NODE_WIDTH / 2,
          top: node.y - TREE_NODE_HEIGHT / 2,
          width: TREE_NODE_WIDTH,
          height: TREE_NODE_HEIGHT,
        },
      ]}
      accessibilityLabel={`${node.person.name}${node.canExpand ? ', expandable' : ''}`}
    >
      <View
        style={[
          styles.avatar,
          {
            backgroundColor: color,
            borderColor: node.isFocus ? Colors.accent : Colors.white,
            borderWidth: node.isFocus ? 3 : 2,
          },
        ]}
      >
        <Text style={styles.avatarText}>{initialsOf(node.person)}</Text>
        {node.canExpand && <View style={styles.expandDot} />}
      </View>
      <Text style={[styles.name, node.isFocus && styles.nameFocus]} numberOfLines={2}>
        {node.person.givenName || node.person.name}
      </Text>
      {!!node.person.surname && (
        <Text style={styles.surname} numberOfLines={1}>
          {node.person.surname}
        </Text>
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
    overflow: 'hidden',
  },
  flex: {
    flex: 1,
  },
  world: {
    ...StyleSheet.absoluteFillObject,
  },
  node: {
    position: 'absolute',
    alignItems: 'center',
    paddingTop: 4,
  },
  nodeFocus: {
    zIndex: 2,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
    borderWidth: 2,
    borderColor: Colors.white,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  avatarText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '700',
  },
  expandDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.accent,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  name: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.text,
    textAlign: 'center',
    width: '100%',
    lineHeight: 13,
  },
  nameFocus: {
    color: Colors.accentDark,
    fontWeight: '700',
  },
  surname: {
    fontSize: 9,
    color: Colors.textSecondary,
    textAlign: 'center',
    width: '100%',
    marginTop: 1,
  },
  hud: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 12,
  },
  hintPill: {
    alignSelf: 'center',
    backgroundColor: 'rgba(253, 251, 249, 0.92)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    maxWidth: '94%',
  },
  hintText: {
    fontSize: 11,
    color: Colors.textSecondary,
    textAlign: 'center',
    fontWeight: '500',
  },
  controls: {
    position: 'absolute',
    right: 12,
    bottom: 52,
    gap: 8,
  },
  hudBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  statsPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(253, 251, 249, 0.92)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  statsText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
});
