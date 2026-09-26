import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { 
  ShareNetwork, 
  MagnifyingGlass, 
  Play, 
  Pause,
  Sparkle,
  Sliders,
  X,
  Lightning,
  Download,
  TrendUp,
  Intersect,
  Table,
  ChartBar,
  Info,
  WarningCircle,
  Funnel,
  GitFork,
  Compass,
  ArrowRight
} from '@phosphor-icons/react';

export default function KnowledgeGraph({ 
  tableData, 
  datasetInfo, 
  columns, 
  onExecuteQuery, 
  onFilterTable,
  onNavigateTab 
}) {
  const canvasRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [secondNode, setSecondNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('graph'); // 'graph' | 'vector'
  const [sizeMode, setSizeMode] = useState('count'); // 'count' | 'value'
  const [isPhysicsActive, setIsPhysicsActive] = useState(true);
  const [activeSidePanel, setActiveSidePanel] = useState('intel'); // 'intel' | 'inspector' | 'paths' | null
  const [activePathIndex, setActivePathIndex] = useState(0);

  // Dragging state
  const draggingNodeRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Identify primary numeric metric column for value-based sizing and driver analytics
  const numericMetricCol = useMemo(() => {
    if (!tableData || tableData.length === 0) return null;
    const cols = columns || Object.keys(tableData[0]);
    return cols.find((c) => {
      const name = c.toLowerCase();
      return (
        (name.includes('sales') || name.includes('amount') || name.includes('revenue') || name.includes('price') || name.includes('cost') || name.includes('profit')) &&
        typeof tableData[0][c] === 'number'
      );
    }) || cols.find((c) => typeof tableData[0][c] === 'number');
  }, [tableData, columns]);

  // Generate Graph Nodes and Edges from dataset schema and data
  const { nodes, edges, hubStats, topPairs, relationshipPairs, anomalySignals, driverSignals, adjacencyMap } = useMemo(() => {
    if (!tableData || tableData.length === 0) {
      return { 
        nodes: [], 
        edges: [], 
        hubStats: [], 
        topPairs: [], 
        relationshipPairs: [], 
        anomalySignals: [], 
        driverSignals: [],
        adjacencyMap: new Map()
      };
    }

    const cols = columns && columns.length > 0 ? columns : Object.keys(tableData[0]);
    const datasetName = datasetInfo?.name || 'Dataset';

    const generatedNodes = [];
    const generatedEdges = [];
    const hubs = [];
    const pairs = [];
    const valueNodeMap = new Map();
    const categoricalColumns = [];
    const nodeLookup = new Map();

    // 1. Root Node
    const rootNode = {
      id: 'root',
      label: datasetName,
      type: 'root',
      color: '#db3552',
      baseRadius: 24,
      radius: 24,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      details: {
        totalRows: tableData.length.toLocaleString(),
        totalCols: cols.length,
        description: 'Primary Dataset Entity',
      },
    };
    generatedNodes.push(rootNode);
    nodeLookup.set('root', rootNode);

    // 2. Column Nodes (Radial Distribution)
    cols.forEach((col, idx) => {
      const angle = (idx / cols.length) * Math.PI * 2;
      const distance = 160 + (idx % 2) * 45;
      const colId = `col-${col}`;

      const sampleVal = tableData.find((r) => r[col] != null)?.[col];
      const isNum = typeof sampleVal === 'number';

      let totalValSum = 0;
      if (isNum && numericMetricCol === col) {
        totalValSum = tableData.reduce((acc, r) => acc + (Number(r[col]) || 0), 0);
      }

      const colNode = {
        id: colId,
        label: col,
        column: col,
        type: 'column',
        dataType: isNum ? 'numeric' : 'categorical',
        color: isNum ? '#8b5cf6' : '#3b82f6',
        baseRadius: 14,
        radius: 14,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        vx: 0,
        vy: 0,
        parent: 'root',
        details: {
          column: col,
          type: isNum ? 'Numeric Metric Hub' : 'Categorical Dimension',
          sample: sampleVal != null ? String(sampleVal) : 'N/A',
          totalSum: isNum ? totalValSum.toLocaleString() : null,
        },
      };
      generatedNodes.push(colNode);
      nodeLookup.set(colId, colNode);

      if (!isNum) categoricalColumns.push(col);

      generatedEdges.push({
        id: `root--${colId}`,
        source: 'root',
        target: colId,
        weight: 1.5,
        color: 'rgba(219, 53, 82, 0.25)',
      });

      // 3. Category / Value Cluster Nodes for Top Categorical Values
      if (!isNum) {
        const valCounts = {};
        const valSums = {};
        tableData.forEach((r) => {
          const v = r[col];
          if (v != null && v !== '') {
            const key = String(v);
            valCounts[key] = (valCounts[key] || 0) + 1;
            if (numericMetricCol && Number.isFinite(Number(r[numericMetricCol]))) {
              valSums[key] = (valSums[key] || 0) + Number(r[numericMetricCol]);
            }
          }
        });

        const sortedVals = Object.entries(valCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);

        sortedVals.forEach(([valName, count], valIdx) => {
          const valAngle = angle + (valIdx - 2) * 0.25;
          const valDistance = distance + 95;
          const valId = `val-${col}-${valName}`;
          const metricSum = valSums[valName] || 0;
          valueNodeMap.set(`${col}::${valName}`, valId);

          // Compute Radius based on sizeMode
          let computedRadius = 10;
          if (sizeMode === 'count') {
            computedRadius = 8 + Math.min(14, (count / tableData.length) * 22);
          } else if (sizeMode === 'value' && metricSum > 0) {
            computedRadius = 8 + Math.min(16, Math.sqrt(metricSum) * 0.06);
          }

          const valNode = {
            id: valId,
            label: valName.length > 15 ? `${valName.slice(0, 15)}…` : valName,
            fullLabel: valName,
            type: 'value',
            column: col,
            value: valName,
            color: '#10b981',
            baseRadius: 10,
            radius: computedRadius,
            x: Math.cos(valAngle) * valDistance,
            y: Math.sin(valAngle) * valDistance,
            vx: 0,
            vy: 0,
            parent: colId,
            details: {
              value: valName,
              column: col,
              frequency: count,
              percentage: `${((count / tableData.length) * 100).toFixed(1)}%`,
              metricSum: metricSum > 0 ? `$${Math.round(metricSum).toLocaleString()}` : null,
            },
          };
          generatedNodes.push(valNode);
          nodeLookup.set(valId, valNode);

          generatedEdges.push({
            id: `${colId}--${valId}`,
            source: colId,
            target: valId,
            weight: 1.0,
            color: 'rgba(16, 185, 129, 0.25)',
          });

          if (valIdx === 0) {
            pairs.push({ entity: `${col}: ${valName}`, count, share: `${((count / tableData.length) * 100).toFixed(0)}%` });
          }
        });
      }

      const nonEmpty = tableData.filter((r) => r[col] != null && r[col] !== '').length;
      const uniqueCount = new Set(tableData.map((r) => r[col]).filter((v) => v != null && v !== '')).size;
      hubs.push({
        name: col,
        type: isNum ? 'Numeric' : 'Categorical',
        connections: uniqueCount,
        coverage: `${((nonEmpty / tableData.length) * 100).toFixed(0)}% filled`,
      });
    });

    // Cross-column co-occurrences and evidence links
    const linkCandidates = [];
    for (let i = 0; i < categoricalColumns.length; i += 1) {
      for (let j = i + 1; j < categoricalColumns.length; j += 1) {
        const colA = categoricalColumns[i];
        const colB = categoricalColumns[j];
        const counts = {};

        tableData.forEach((row) => {
          const valueA = row[colA] == null || row[colA] === '' ? null : String(row[colA]);
          const valueB = row[colB] == null || row[colB] === '' ? null : String(row[colB]);
          if (!valueA || !valueB) return;
          const source = valueNodeMap.get(`${colA}::${valueA}`);
          const target = valueNodeMap.get(`${colB}::${valueB}`);
          if (!source || !target) return;
          const key = `${source}__${target}`;
          if (!counts[key]) {
            counts[key] = { source, target, colA, colB, valueA, valueB, count: 0, metricTotal: 0 };
          }
          counts[key].count += 1;
          if (numericMetricCol && Number.isFinite(Number(row[numericMetricCol]))) {
            counts[key].metricTotal += Number(row[numericMetricCol]);
          }
        });

        linkCandidates.push(...Object.values(counts));
      }
    }

    linkCandidates
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .forEach((link) => {
        generatedEdges.push({
          id: `${link.source}--${link.target}`,
          source: link.source,
          target: link.target,
          weight: 1.2 + Math.min(2.5, (link.count / Math.max(1, tableData.length)) * 8),
          color: 'rgba(52, 211, 153, 0.55)',
          relationship: true,
          colA: link.colA,
          colB: link.colB,
          valueA: link.valueA,
          valueB: link.valueB,
          count: link.count,
          share: `${((link.count / tableData.length) * 100).toFixed(1)}%`,
          metricTotal: link.metricTotal
        });
      });

    const relationshipPairs = linkCandidates
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((link) => ({
        ...link,
        share: `${((link.count / tableData.length) * 100).toFixed(1)}%`,
      }));

    // Build Graph Adjacency Map for Fast Multi-Hop Path Finding
    const adjMap = new Map();
    generatedNodes.forEach((n) => adjMap.set(n.id, []));
    generatedEdges.forEach((e) => {
      if (adjMap.has(e.source)) adjMap.get(e.source).push({ target: e.target, edge: e });
      if (adjMap.has(e.target)) adjMap.get(e.target).push({ target: e.source, edge: e });
    });

    // 4. Discover Anomaly & Risk Signals
    const anomalies = [];
    linkCandidates.forEach((link) => {
      const valANode = nodeLookup.get(link.source);
      if (valANode && valANode.details?.frequency) {
        const concentrationInA = link.count / valANode.details.frequency;
        if (concentrationInA >= 0.70 && valANode.details.frequency >= Math.min(5, Math.ceil(tableData.length * 0.05))) {
          anomalies.push({
            type: 'bottleneck',
            title: `High Concentration: ${link.valueA} ➔ ${link.valueB}`,
            desc: `${(concentrationInA * 100).toFixed(0)}% of records with ${link.colA}='${link.valueA}' are exclusively paired with ${link.colB}='${link.valueB}'.`,
            colA: link.colA,
            valA: link.valueA,
            colB: link.colB,
            valB: link.valueB,
            severity: concentrationInA > 0.85 ? 'high' : 'medium'
          });
        }
      }
    });

    // 5. Discover Driver Signals (Revenue & Volume Drivers)
    const drivers = [];
    if (numericMetricCol) {
      const topMetricPairs = [...linkCandidates]
        .filter((l) => l.metricTotal > 0)
        .sort((a, b) => b.metricTotal - a.metricTotal)
        .slice(0, 4);

      topMetricPairs.forEach((pair) => {
        drivers.push({
          type: 'metric_leader',
          title: `${pair.valueA} + ${pair.valueB}`,
          desc: `Generates $${Math.round(pair.metricTotal).toLocaleString()} ${numericMetricCol} across ${pair.count.toLocaleString()} transactions.`,
          colA: pair.colA,
          valA: pair.valueA,
          colB: pair.colB,
          valB: pair.valueB,
          metricTotal: pair.metricTotal,
          count: pair.count
        });
      });
    }

    return {
      nodes: generatedNodes,
      edges: generatedEdges,
      hubStats: hubs.sort((a, b) => b.connections - a.connections).slice(0, 4),
      topPairs: pairs.sort((a, b) => b.count - a.count).slice(0, 4),
      relationshipPairs,
      anomalySignals: anomalies.slice(0, 4),
      driverSignals: drivers,
      adjacencyMap: adjMap
    };
  }, [tableData, datasetInfo, columns, numericMetricCol, sizeMode]);

  // Multi-Hop Path Finding Algorithm (BFS / Shortest and Strongest Paths between 2 nodes)
  const discoveredPaths = useMemo(() => {
    if (!selectedNode || !secondNode || !adjacencyMap) return [];
    if (selectedNode.id === secondNode.id) return [];

    const startId = selectedNode.id;
    const endId = secondNode.id;
    const pathsFound = [];

    // Queue format: { currentId, path: [nodeIds], visited: Set }
    const queue = [{ currentId: startId, path: [startId], visited: new Set([startId]) }];

    while (queue.length > 0 && pathsFound.length < 5) {
      const { currentId, path, visited } = queue.shift();

      if (path.length > 4) continue; // max 4 hops

      const neighbors = adjacencyMap.get(currentId) || [];
      for (const { target } of neighbors) {
        if (target === endId) {
          pathsFound.push([...path, endId]);
          break;
        }
        if (!visited.has(target)) {
          const nextVisited = new Set(visited);
          nextVisited.add(target);
          queue.push({
            currentId: target,
            path: [...path, target],
            visited: nextVisited
          });
        }
      }
    }

    // Map discovered node IDs back to node metadata and cohort analytics
    return pathsFound.map((nodeIds, index) => {
      const pathNodes = nodeIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean);
      const valueNodes = pathNodes.filter((n) => n.type === 'value');

      // Calculate cohort records matching all value nodes on this path
      let matchingRows = tableData || [];
      if (valueNodes.length > 0) {
        matchingRows = matchingRows.filter((row) =>
          valueNodes.every((vn) => String(row[vn.column]) === String(vn.value))
        );
      }

      let metricSum = 0;
      if (numericMetricCol && matchingRows.length > 0) {
        metricSum = matchingRows.reduce((acc, r) => acc + (Number(r[numericMetricCol]) || 0), 0);
      }

      return {
        id: `path-${index}`,
        nodeIds,
        pathNodes,
        valueNodes,
        hops: pathNodes.length - 1,
        matchCount: matchingRows.length,
        matchPercentage: ((matchingRows.length / (tableData?.length || 1)) * 100).toFixed(1),
        metricSum: metricSum > 0 ? `$${Math.round(metricSum).toLocaleString()}` : null,
      };
    });
  }, [selectedNode, secondNode, adjacencyMap, nodes, tableData, numericMetricCol]);

  // Compute Active Cohort when Nodes or Edges are selected for Visual Subgraph Slicing
  const activeCohort = useMemo(() => {
    if (!tableData || tableData.length === 0) return null;

    let targetValueNodes = [];

    if (selectedEdge) {
      const srcNode = nodes.find((n) => n.id === selectedEdge.source);
      const tgtNode = nodes.find((n) => n.id === selectedEdge.target);
      if (srcNode?.type === 'value') targetValueNodes.push(srcNode);
      if (tgtNode?.type === 'value') targetValueNodes.push(tgtNode);
    } else if (selectedNode && secondNode) {
      if (selectedNode.type === 'value') targetValueNodes.push(selectedNode);
      if (secondNode.type === 'value') targetValueNodes.push(secondNode);
    } else if (selectedNode) {
      if (selectedNode.type === 'value') targetValueNodes.push(selectedNode);
    }

    if (targetValueNodes.length === 0) return null;

    const matches = tableData.filter((row) =>
      targetValueNodes.every((node) => String(row[node.column]) === String(node.value))
    );

    let sumMetric = 0;
    if (numericMetricCol) {
      sumMetric = matches.reduce((acc, r) => acc + (Number(r[numericMetricCol]) || 0), 0);
    }

    const queryConditions = targetValueNodes
      .map((n) => `${n.column} is '${n.value}'`)
      .join(' and ');

    return {
      nodes: targetValueNodes,
      count: matches.length,
      percentage: `${((matches.length / tableData.length) * 100).toFixed(1)}%`,
      filterQuery: `show records where ${queryConditions}`,
      promptQuery: `Show summary and distribution where ${queryConditions}`,
    };
  }, [selectedEdge, selectedNode, secondNode, nodes, tableData, numericMetricCol]);

  // Node Positions and Animation Physics Loop
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes.map((n) => ({ ...n }));
  }, [nodes]);

  // Main Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const handleResize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Draw Subtle Background Grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = 1;
      const gridSize = 36;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const activeNodes = nodesRef.current;
      const activePath = discoveredPaths[activePathIndex];
      const activePathNodeIds = new Set(activePath?.nodeIds || []);

      // Update Node Physics Simulation
      if (isPhysicsActive) {
        activeNodes.forEach((node, i) => {
          if (node === draggingNodeRef.current) return;

          const time = Date.now() * 0.001;
          const floatOffset = Math.sin(time + i) * 0.25;
          node.y += floatOffset;

          if (viewMode === 'vector' && node.type !== 'root') {
            const groupIndex = node.type === 'column' ? 1.2 : 2.2;
            const targetDist = 130 * groupIndex;
            const currentDist = Math.hypot(node.x, node.y) || 1;
            const factor = (targetDist - currentDist) * 0.02;
            node.x += (node.x / currentDist) * factor;
            node.y += (node.y / currentDist) * factor;
          }
        });
      }

      // Draw Edges
      edges.forEach((edge) => {
        const sourceNode = activeNodes.find((n) => n.id === edge.source);
        const targetNode = activeNodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) return;

        const sx = sourceNode.x + centerX;
        const sy = sourceNode.y + centerY;
        const tx = targetNode.x + centerX;
        const ty = targetNode.y + centerY;

        const isEdgeInActivePath =
          activePathNodeIds.size > 0 &&
          activePathNodeIds.has(sourceNode.id) &&
          activePathNodeIds.has(targetNode.id);

        const isHighlighted =
          isEdgeInActivePath ||
          (selectedEdge && selectedEdge.id === edge.id) ||
          (hoveredEdge && hoveredEdge.id === edge.id) ||
          (hoveredNode && (hoveredNode.id === sourceNode.id || hoveredNode.id === targetNode.id)) ||
          (selectedNode && (selectedNode.id === sourceNode.id || selectedNode.id === targetNode.id)) ||
          (secondNode && (secondNode.id === sourceNode.id || secondNode.id === targetNode.id));

        // Dim edges not in active path if a path is actively traced
        const shouldDim = activePathNodeIds.size > 0 && !isEdgeInActivePath;

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = isEdgeInActivePath
          ? '#10b981'
          : isHighlighted
          ? 'rgba(219, 53, 82, 0.85)'
          : shouldDim
          ? 'rgba(255, 255, 255, 0.05)'
          : edge.color;
        ctx.lineWidth = isEdgeInActivePath ? 3.5 : isHighlighted ? 2.5 : edge.weight;
        ctx.setLineDash(edge.relationship ? [4, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);

        // Animated flow particles along active paths or highlighted connections
        if (isPhysicsActive && (isHighlighted || isEdgeInActivePath || !shouldDim)) {
          const time = (Date.now() * (isEdgeInActivePath ? 0.0025 : 0.0012) + activeNodes.indexOf(sourceNode)) % 1;
          const px = sx + (tx - sx) * time;
          const py = sy + (ty - sy) * time;
          ctx.beginPath();
          ctx.arc(px, py, isEdgeInActivePath ? 3.5 : 2, 0, Math.PI * 2);
          ctx.fillStyle = isEdgeInActivePath ? '#10b981' : isHighlighted ? '#db3552' : '#ffffff';
          ctx.fill();
        }
      });

      // Draw Nodes
      activeNodes.forEach((node) => {
        const nx = node.x + centerX;
        const ny = node.y + centerY;

        const isHovered = hoveredNode?.id === node.id;
        const isSelected = selectedNode?.id === node.id;
        const isSecond = secondNode?.id === node.id;
        const isInActivePath = activePathNodeIds.has(node.id);
        const isMatchSearch = searchQuery && node.label.toLowerCase().includes(searchQuery.toLowerCase());
        const shouldDim = activePathNodeIds.size > 0 && !isInActivePath;

        const opacity = shouldDim ? 0.25 : 1.0;
        ctx.globalAlpha = opacity;

        // Aura Rings
        if (viewMode === 'vector' || isHovered || isSelected || isSecond || isInActivePath || isMatchSearch) {
          ctx.beginPath();
          ctx.arc(nx, ny, node.radius + (isHovered || isSelected || isInActivePath ? 12 : 8), 0, Math.PI * 2);
          ctx.fillStyle = isInActivePath ? '#10b98133' : isSecond ? '#10b98133' : `${node.color}22`;
          ctx.fill();
          ctx.strokeStyle = isInActivePath ? '#10b981' : isSecond ? '#10b981' : node.color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Solid Node Circle
        ctx.beginPath();
        ctx.arc(nx, ny, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = isInActivePath ? '#10b981' : isSecond ? '#10b981' : node.color;
        ctx.fill();
        ctx.strokeStyle = isSelected || isSecond || isInActivePath ? '#ffffff' : 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = isSelected || isSecond || isInActivePath ? 3 : 1.5;
        ctx.stroke();

        // Node Label
        ctx.font = node.type === 'root' ? 'bold 12px "Space Mono", monospace' : '10px "Space Mono", monospace';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, nx, ny + node.radius + 14);

        ctx.globalAlpha = 1.0;
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [edges, viewMode, isPhysicsActive, hoveredNode, hoveredEdge, selectedNode, secondNode, selectedEdge, searchQuery, discoveredPaths, activePathIndex]);

  // Pointer Interactivity (Hover, Select, Drag)
  const getNodeAtCoords = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left - canvas.width / 2;
    const y = clientY - rect.top - canvas.height / 2;

    return nodesRef.current.find((node) => {
      const dist = Math.hypot(node.x - x, node.y - y);
      return dist <= node.radius + 6;
    });
  };

  const handlePointerDown = (e) => {
    const node = getNodeAtCoords(e.clientX, e.clientY);
    if (node) {
      draggingNodeRef.current = node;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left - canvas.width / 2;
      const clickY = e.clientY - rect.top - canvas.height / 2;
      dragOffsetRef.current = { x: node.x - clickX, y: node.y - clickY };

      setSelectedEdge(null);

      // Handle Node Selection (Single or Multi-Node / Path Finder Mode)
      if (e.shiftKey || selectedNode) {
        if (selectedNode && selectedNode.id !== node.id) {
          setSecondNode(node);
          setActiveSidePanel('paths');
        } else {
          setSelectedNode(node);
          setSecondNode(null);
          setActiveSidePanel('inspector');
        }
      } else {
        setSelectedNode(node);
        setSecondNode(null);
        setActiveSidePanel('inspector');
      }
    } else {
      // Click canvas background to deselect
      setSelectedNode(null);
      setSecondNode(null);
      setSelectedEdge(null);
    }
  };

  const handlePointerMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    if (draggingNodeRef.current) {
      const clickX = e.clientX - rect.left - canvas.width / 2;
      const clickY = e.clientY - rect.top - canvas.height / 2;
      draggingNodeRef.current.x = clickX + dragOffsetRef.current.x;
      draggingNodeRef.current.y = clickY + dragOffsetRef.current.y;
    } else {
      const hovered = getNodeAtCoords(e.clientX, e.clientY);
      setHoveredNode(hovered);
      canvas.style.cursor = hovered ? 'pointer' : 'default';
    }
  };

  const handlePointerUp = () => {
    draggingNodeRef.current = null;
  };

  // Export Graph Screenshot as PNG
  const handleExportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `knowledge_graph_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // One-Click AI Graph Synthesis
  const handleSynthesizeNarrative = () => {
    if (!onExecuteQuery) return;
    const primaryHub = hubStats[0]?.name || (columns && columns[0]);
    const secondaryHub = hubStats[1]?.name;
    const prompt = secondaryHub 
      ? `Show distribution and breakdown across ${primaryHub} and ${secondaryHub}`
      : primaryHub 
      ? `Show distribution and summary of ${primaryHub}`
      : 'Show summary distribution of records';

    onExecuteQuery(prompt);
  };

  return (
    <div className="flex h-full w-full bg-[#161214] text-white relative overflow-hidden select-none">

      {/* Top Floating Control Bar */}
      <div className="absolute top-4 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-3 bg-black/75 backdrop-blur-md border border-white/10 p-3 rounded-xl shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ShareNetwork size={18} className="text-[var(--color-accent)]" />
            <h3 className="text-xs font-mono font-bold tracking-tight">KNOWLEDGE GRAPH & INTELLIGENCE</h3>
          </div>
          <span className="text-[9px] font-mono bg-white/10 px-2 py-0.5 rounded text-zinc-300">
            {nodes.length} Nodes · {edges.length} Links
          </span>
        </div>

        {/* Search, Controls & Export */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <MagnifyingGlass size={13} className="absolute left-2.5 top-2.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white/5 border border-white/10 text-xs font-mono pl-8 pr-3 py-1.5 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-[var(--color-accent)] w-36 sm:w-44"
            />
          </div>

          {/* Sizing Mode Toggle */}
          <div className="flex items-center bg-white/5 border border-white/10 p-1 rounded-lg text-[10px] font-mono">
            <button
              onClick={() => setSizeMode('count')}
              className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-all ${
                sizeMode === 'count' ? 'bg-[var(--color-accent)] text-white' : 'text-zinc-400 hover:text-white'
              }`}
              title="Scale nodes by record frequency"
            >
              Frequency
            </button>
            <button
              onClick={() => setSizeMode('value')}
              className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-all ${
                sizeMode === 'value' ? 'bg-[var(--color-accent)] text-white' : 'text-zinc-400 hover:text-white'
              }`}
              title="Scale nodes by metric value/revenue"
            >
              Volume
            </button>
          </div>

          {/* Graph vs Vector Mode */}
          <div className="flex items-center bg-white/5 border border-white/10 p-1 rounded-lg text-[10px] font-mono">
            <button
              onClick={() => setViewMode('graph')}
              className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-all ${
                viewMode === 'graph' ? 'bg-[var(--color-accent)] text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Schema Graph
            </button>
            <button
              onClick={() => setViewMode('vector')}
              className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-all ${
                viewMode === 'vector' ? 'bg-[var(--color-accent)] text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Vector Clusters
            </button>
          </div>

          {/* Side Drawer Toggle Tabs */}
          <button
            onClick={() => setActiveSidePanel(activeSidePanel === 'intel' ? null : 'intel')}
            className={`p-2 rounded-lg border text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
              activeSidePanel === 'intel' ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white' : 'bg-white/5 border-white/10 text-zinc-300 hover:text-white'
            }`}
            title="Toggle Graph Intelligence Panel"
          >
            <TrendUp size={13} />
            <span>Signals</span>
            <span className="rounded bg-white/15 px-1.5 py-0.5 text-[9px] text-emerald-300">{anomalySignals.length + driverSignals.length}</span>
          </button>

          {selectedNode && secondNode && (
            <button
              onClick={() => setActiveSidePanel(activeSidePanel === 'paths' ? null : 'paths')}
              className={`p-2 rounded-lg border text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                activeSidePanel === 'paths' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-white/5 border-white/10 text-emerald-400 hover:text-white'
              }`}
              title="View Discovered Paths"
            >
              <GitFork size={13} />
              <span>Paths ({discoveredPaths.length})</span>
            </button>
          )}

          <button
            onClick={handleExportPNG}
            className="p-2 rounded-lg border border-white/10 bg-white/5 text-zinc-300 hover:text-white transition-all cursor-pointer"
            title="Download PNG Screenshot"
          >
            <Download size={13} />
          </button>

          <button
            onClick={() => setIsPhysicsActive(!isPhysicsActive)}
            className="p-2 rounded-lg border border-white/10 bg-white/5 text-zinc-300 hover:text-white transition-all cursor-pointer"
            title={isPhysicsActive ? 'Pause Physics' : 'Play Physics'}
          >
            {isPhysicsActive ? <Pause size={13} className="text-emerald-400" /> : <Play size={13} />}
          </button>
        </div>
      </div>

      {/* Main Interactive Canvas */}
      <div className="flex-1 h-full w-full relative">
        <canvas
          ref={canvasRef}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          className="w-full h-full block"
        />

        {/* Floating Subgraph / Cohort Quick Action Badge */}
        {activeCohort && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-[#1e171b]/95 backdrop-blur-md border border-emerald-500/40 px-4 py-2.5 rounded-xl shadow-2xl">
            <div className="flex items-center gap-2">
              <Intersect size={16} className="text-emerald-400 animate-pulse" />
              <div>
                <p className="text-[11px] font-mono font-bold text-white">
                  Active Cohort: {activeCohort.nodes.map((n) => `${n.column}='${n.value}'`).join(' ∩ ')}
                </p>
                <p className="text-[9px] font-mono text-zinc-400">
                  {activeCohort.count.toLocaleString()} rows ({activeCohort.percentage}){activeCohort.metricSum ? ` · ${activeCohort.metricSum}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 pl-2 border-l border-white/10">
              {onFilterTable && (
                <button
                  onClick={() => onFilterTable(activeCohort.filterQuery)}
                  className="btn-secondary px-2.5 py-1 text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer"
                  title="Filter Data Table by this Subgraph Cohort"
                >
                  <Table size={12} className="text-emerald-400" />
                  <span>Slice Table</span>
                </button>
              )}

              {onNavigateTab && (
                <button
                  onClick={() => onNavigateTab('visualize')}
                  className="btn-secondary px-2.5 py-1 text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer"
                  title="Build Chart for this Cohort"
                >
                  <ChartBar size={12} className="text-[var(--color-accent)]" />
                  <span>Plot Cohort</span>
                </button>
              )}

              {onExecuteQuery && (
                <button
                  onClick={() => onExecuteQuery(activeCohort.promptQuery)}
                  className="btn-primary px-2.5 py-1 text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer"
                  title="Ask AI to Explain Cohort"
                >
                  <Lightning size={12} />
                  <span>Ask AI</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Floating Helper Tip Banner */}
        <div className="absolute bottom-4 left-4 z-10 text-[10px] font-mono text-zinc-400 bg-black/75 border border-white/10 px-3 py-1.5 rounded-lg flex items-center gap-3">
          <span>💡 Shift+Click 2 nodes for Multi-Hop Path Finding</span>
          <span>•</span>
          <span>Click any node or link to slice dataset</span>
          <span>•</span>
          <span>Drag nodes to organize</span>
        </div>
      </div>

      {/* Drawer 1: Graph Intelligence & Root-Cause Signals */}
      {activeSidePanel === 'intel' && (
        <div className="w-84 h-full border-l border-white/10 bg-[#181215] p-5 z-20 flex flex-col space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <TrendUp size={16} className="text-[var(--color-accent)]" />
              <h4 className="text-xs font-mono font-bold text-white uppercase">Graph Intelligence</h4>
            </div>
            <button onClick={() => setActiveSidePanel(null)} className="text-zinc-400 hover:text-white cursor-pointer">
              <X size={14} />
            </button>
          </div>

          {/* One-Click Executive AI Synthesis */}
          {onExecuteQuery && (
            <button
              onClick={handleSynthesizeNarrative}
              className="w-full btn-primary py-2 text-xs font-mono font-bold flex items-center justify-center gap-2 shadow-lg cursor-pointer"
            >
              <Sparkle size={14} className="text-amber-300" />
              <span>Synthesize Graph Narrative</span>
            </button>
          )}

          <div className="space-y-4 text-xs font-mono">
            {/* Key Driver Signals */}
            {driverSignals.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-zinc-400 uppercase font-bold">Top Value & Revenue Drivers</p>
                  <span className="text-[9px] text-emerald-400">drivers</span>
                </div>
                {driverSignals.map((driver, index) => (
                  <div key={`driver-${index}`} className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <TrendUp size={15} className="text-emerald-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] text-white font-bold leading-snug">{driver.title}</p>
                        <p className="text-[10px] text-zinc-400 leading-relaxed mt-1">{driver.desc}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      {onFilterTable && (
                        <button
                          onClick={() => onFilterTable(`show records where ${driver.colA} is '${driver.valA}' and ${driver.colB} is '${driver.valB}'`)}
                          className="flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[9px] text-zinc-200 hover:bg-white/10 cursor-pointer"
                        >
                          <Table size={10} className="inline mr-1" />
                          Filter
                        </button>
                      )}
                      {onExecuteQuery && (
                        <button
                          onClick={() => onExecuteQuery(`Show distribution and comparison where ${driver.colA} is '${driver.valA}' and ${driver.colB} is '${driver.valB}'`)}
                          className="flex-1 rounded-md bg-[var(--color-accent)] px-2 py-1 text-[9px] text-white hover:opacity-90 cursor-pointer"
                        >
                          <Lightning size={10} className="inline mr-1" />
                          Deep-Dive
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Relational Anomalies & Bottlenecks */}
            {anomalySignals.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-amber-400 uppercase font-bold">Relational Bottlenecks & Outliers</p>
                  <span className="text-[9px] text-amber-400">anomalies</span>
                </div>
                {anomalySignals.map((anomaly, index) => (
                  <div key={`anomaly-${index}`} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <WarningCircle size={15} className="text-amber-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] text-white font-bold leading-snug">{anomaly.title}</p>
                        <p className="text-[10px] text-zinc-400 leading-relaxed mt-1">{anomaly.desc}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      {onFilterTable && (
                        <button
                          onClick={() => onFilterTable(`show records where ${anomaly.colA} is '${anomaly.valA}' and ${anomaly.colB} is '${anomaly.valB}'`)}
                          className="flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[9px] text-zinc-200 hover:bg-white/10 cursor-pointer"
                        >
                          <Table size={10} className="inline mr-1" />
                          Inspect
                        </button>
                      )}
                      {onExecuteQuery && (
                        <button
                          onClick={() => onExecuteQuery(`Show count and breakdown where ${anomaly.colA} is '${anomaly.valA}' and ${anomaly.colB} is '${anomaly.valB}'`)}
                          className="flex-1 rounded-md bg-amber-600 px-2 py-1 text-[9px] text-white hover:opacity-90 cursor-pointer"
                        >
                          <Lightning size={10} className="inline mr-1" />
                          Analyze
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Hub Centrality */}
            <div className="card p-3 bg-white/5 border-white/10 space-y-2">
              <p className="text-[10px] text-zinc-400 uppercase font-bold">Most Connected Dimensions</p>
              {hubStats.map((h, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-white font-bold">{h.name}</span>
                  <span className="text-zinc-400 text-[10px]">{h.connections} distinct · {h.coverage}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Drawer 2: Discovered Multi-Hop Paths Panel */}
      {activeSidePanel === 'paths' && selectedNode && secondNode && (
        <div className="w-84 h-full border-l border-white/10 bg-[#191417] p-5 z-20 flex flex-col space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <GitFork size={16} className="text-emerald-400" />
              <h4 className="text-xs font-mono font-bold text-white uppercase">Discovered Paths</h4>
            </div>
            <button onClick={() => setActiveSidePanel(null)} className="text-zinc-400 hover:text-white cursor-pointer">
              <X size={14} />
            </button>
          </div>

          <div className="card p-3 bg-emerald-500/10 border-emerald-500/30 space-y-2 text-xs font-mono">
            <p className="text-[10px] text-emerald-400 uppercase font-bold">Origin ➔ Destination</p>
            <div className="flex items-center gap-2 text-white font-bold">
              <span className="truncate max-w-[100px]">{selectedNode.label}</span>
              <ArrowRight size={14} className="text-emerald-400 shrink-0" />
              <span className="truncate max-w-[100px]">{secondNode.label}</span>
            </div>
          </div>

          <div className="space-y-3 flex-1 text-xs font-mono">
            <p className="text-[10px] text-zinc-400 uppercase font-bold">Discovered Traversal Paths ({discoveredPaths.length})</p>

            {discoveredPaths.length > 0 ? (
              discoveredPaths.map((p, idx) => (
                <div
                  key={p.id}
                  onClick={() => setActivePathIndex(idx)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all space-y-2 ${
                    activePathIndex === idx
                      ? 'bg-emerald-500/20 border-emerald-400 shadow-md'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-emerald-300">Path #{idx + 1} ({p.hops} hops)</span>
                    <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded text-zinc-300">{p.matchCount} rows ({p.matchPercentage})</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1 text-[10px] text-zinc-200">
                    {p.pathNodes.map((n, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span className={`px-1.5 py-0.5 rounded ${n.type === 'value' ? 'bg-emerald-400/20 text-emerald-300' : 'bg-blue-400/20 text-blue-300'}`}>
                          {n.label}
                        </span>
                        {i < p.pathNodes.length - 1 && <ArrowRight size={10} className="text-zinc-500" />}
                      </span>
                    ))}
                  </div>

                  {p.metricSum && (
                    <p className="text-[9px] text-emerald-400">Cohort Revenue / Metric: {p.metricSum}</p>
                  )}

                  <div className="flex gap-2 pt-1">
                    {onFilterTable && p.valueNodes.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const conditions = p.valueNodes.map((n) => `${n.column} is '${n.value}'`).join(' and ');
                          onFilterTable(`show records where ${conditions}`);
                        }}
                        className="flex-1 rounded border border-white/10 bg-white/5 py-1 text-[9px] text-zinc-200 hover:bg-white/10 cursor-pointer"
                      >
                        <Table size={10} className="inline mr-1" />
                        Filter Table
                      </button>
                    )}

                    {onExecuteQuery && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const valueConditions = p.valueNodes.length > 0
                            ? p.valueNodes.map((n) => `${n.column} is '${n.value}'`).join(' and ')
                            : `${selectedNode.label} and ${secondNode.label}`;
                          onExecuteQuery(`Show records and comparison where ${valueConditions}`);
                        }}
                        className="flex-1 rounded bg-[var(--color-accent)] py-1 text-[9px] text-white hover:opacity-90 cursor-pointer"
                      >
                        <Lightning size={10} className="inline mr-1" />
                        Explain Path
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                No direct or multi-hop path found connecting these two specific nodes. Try selecting different dimensions.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Drawer 3: Single Node Inspector */}
      {activeSidePanel === 'inspector' && selectedNode && !secondNode && (
        <div className="w-84 h-full border-l border-white/10 bg-[#1d181a] p-5 z-20 flex flex-col space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full" style={{ background: selectedNode.color }} />
              <h4 className="text-xs font-mono font-bold text-white uppercase truncate max-w-[180px]">{selectedNode.label}</h4>
            </div>
            <button onClick={() => setActiveSidePanel(null)} className="text-zinc-400 hover:text-white cursor-pointer">
              <X size={14} />
            </button>
          </div>

          <div className="space-y-3 flex-1 text-xs font-mono">
            <div className="card p-3 bg-white/5 border-white/10 space-y-1">
              <p className="text-[10px] text-zinc-400 uppercase">Entity Class</p>
              <p className="font-bold text-white uppercase">{selectedNode.type}</p>
            </div>

            {selectedNode.details && (
              <div className="card p-3 bg-white/5 border-white/10 space-y-2">
                <p className="text-[10px] text-zinc-400 uppercase font-bold">Node Metadata</p>
                {Object.entries(selectedNode.details).map(([key, val]) => (
                  val != null && (
                    <div key={key} className="flex justify-between text-[11px]">
                      <span className="text-zinc-400 capitalize">{key}:</span>
                      <span className="text-white font-bold">{String(val)}</span>
                    </div>
                  )
                ))}
              </div>
            )}

            {/* Interactive Action Toolkit */}
            <div className="pt-2 space-y-2">
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Node Actions</p>

              {/* Action 1: Filter Table */}
              {selectedNode.column && onFilterTable && (
                <button
                  onClick={() => {
                    onFilterTable(selectedNode.column, selectedNode.value || selectedNode.label);
                  }}
                  className="w-full btn-secondary py-2 text-xs font-mono font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Table size={14} className="text-[var(--color-accent)]" />
                  <span>Filter Table for "{selectedNode.label}"</span>
                </button>
              )}

              {/* Action 2: Ask AI Deep-Dive */}
              {onExecuteQuery && (
                <button
                  onClick={() => {
                    const prompt = selectedNode.value
                      ? `Show summary and distribution for ${selectedNode.column} '${selectedNode.value}'`
                      : `Show distribution and summary of ${selectedNode.label}`;
                    onExecuteQuery(prompt);
                  }}
                  className="w-full btn-primary py-2.5 text-xs font-mono font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Lightning size={14} />
                  <span>Ask AI Deep-Dive</span>
                </button>
              )}

              {/* Action 3: Build Custom Chart */}
              {onNavigateTab && (
                <button
                  onClick={() => onNavigateTab('visualize')}
                  className="w-full btn-secondary py-2 text-xs font-mono font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ChartBar size={14} />
                  <span>Build Custom Chart →</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
