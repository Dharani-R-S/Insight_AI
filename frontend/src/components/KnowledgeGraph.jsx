import { useEffect, useRef, useState, useMemo } from 'react';
import { 
  ShareNetwork, 
  MagnifyingGlass, 
  Play, 
  Sparkle,
  Sliders,
  X,
  Lightning,
  Download,
  TrendUp,
  Intersect,
  Table,
  ChartBar,
  Info
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
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('graph'); // 'graph' | 'vector'
  const [sizeMode, setSizeMode] = useState('count'); // 'count' | 'value'
  const [isPhysicsActive, setIsPhysicsActive] = useState(true);
  const [showIntelPanel, setShowIntelPanel] = useState(true);

  // Dragging state
  const draggingNodeRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Identify primary numeric metric column for value-based sizing
  const numericMetricCol = useMemo(() => {
    if (!tableData || tableData.length === 0) return null;
    const cols = columns || Object.keys(tableData[0]);
    return cols.find((c) => {
      const name = c.toLowerCase();
      return (
        (name.includes('sales') || name.includes('amount') || name.includes('revenue') || name.includes('price') || name.includes('cost')) &&
        typeof tableData[0][c] === 'number'
      );
    }) || cols.find((c) => typeof tableData[0][c] === 'number');
  }, [tableData, columns]);

  // Generate Graph Nodes and Edges from dataset schema and data
  const { nodes, edges, hubStats, topPairs, relationshipPairs } = useMemo(() => {
    if (!tableData || tableData.length === 0) {
      return { nodes: [], edges: [], hubStats: [], topPairs: [], relationshipPairs: [] };
    }

    const cols = columns && columns.length > 0 ? columns : Object.keys(tableData[0]);
    const datasetName = datasetInfo?.name || 'Dataset';

    const generatedNodes = [];
    const generatedEdges = [];
    const hubs = [];
    const pairs = [];
    const valueNodeMap = new Map();
    const categoricalColumns = [];

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
          type: isNum ? 'Numeric Field' : 'Categorical Dimension',
          sample: sampleVal != null ? String(sampleVal) : 'N/A',
          totalSum: isNum ? totalValSum.toLocaleString() : null,
        },
      };
      generatedNodes.push(colNode);

      if (!isNum) categoricalColumns.push(col);

      generatedEdges.push({
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
          .slice(0, 4);

        sortedVals.forEach(([valName, count], valIdx) => {
          const valAngle = angle + (valIdx - 1.5) * 0.3;
          const valDistance = distance + 95;
          const valId = `val-${col}-${valName}`;
          const metricSum = valSums[valName] || 0;
          valueNodeMap.set(`${col}::${valName}`, valId);

          // Compute Radius based on sizeMode
          let computedRadius = 10;
          if (sizeMode === 'count') {
            computedRadius = 8 + Math.min(12, (count / tableData.length) * 20);
          } else if (sizeMode === 'value' && metricSum > 0) {
            computedRadius = 8 + Math.min(14, Math.sqrt(metricSum) * 0.05);
          }

          const valNode = {
            id: valId,
            label: valName.length > 14 ? `${valName.slice(0, 14)}…` : valName,
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

          generatedEdges.push({
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
        connections: isNum ? uniqueCount : uniqueCount,
        coverage: `${((nonEmpty / tableData.length) * 100).toFixed(0)}% filled`,
      });
    });

    // Add evidence links between values that occur in the same records. These are the
    // useful relationships that turn the graph from a schema map into an exploration tool.
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
          counts[key] = counts[key] || { source, target, colA, colB, valueA, valueB, count: 0 };
          counts[key].count += 1;
        });

        linkCandidates.push(...Object.values(counts));
      }
    }

    linkCandidates
      .sort((a, b) => b.count - a.count)
      .slice(0, 14)
      .forEach((link) => {
        generatedEdges.push({
          source: link.source,
          target: link.target,
          weight: 1 + Math.min(2, link.count / Math.max(1, tableData.length) * 8),
          color: 'rgba(52, 211, 153, 0.55)',
          relationship: true,
        });
      });

    const relationshipPairs = linkCandidates
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((link) => ({
        ...link,
        share: `${((link.count / tableData.length) * 100).toFixed(1)}%`,
      }));

    return {
      nodes: generatedNodes,
      edges: generatedEdges,
      hubStats: hubs.sort((a, b) => b.connections - a.connections).slice(0, 4),
      topPairs: pairs.sort((a, b) => b.count - a.count).slice(0, 4),
      relationshipPairs,
    };
  }, [tableData, datasetInfo, columns, numericMetricCol, sizeMode]);

  // Translate graph structure into findings a user can act on immediately.
  const graphFindings = useMemo(() => {
    if (!tableData || tableData.length === 0) return [];

    const cols = columns && columns.length > 0 ? columns : Object.keys(tableData[0]);
    const categorical = cols.filter((col) => {
      const sample = tableData.find((row) => row[col] != null && row[col] !== '')?.[col];
      return sample == null || !Number.isFinite(Number(sample));
    });
    const segments = [];

    categorical.forEach((col) => {
      const groups = {};
      tableData.forEach((row) => {
        const raw = row[col];
        if (raw == null || raw === '') return;
        const value = String(raw);
        groups[value] = groups[value] || { value, count: 0, metricTotal: 0 };
        groups[value].count += 1;
        if (numericMetricCol && Number.isFinite(Number(row[numericMetricCol]))) {
          groups[value].metricTotal += Number(row[numericMetricCol]);
        }
      });
      Object.values(groups).forEach((group) => {
        segments.push({ ...group, column: col, share: group.count / tableData.length });
      });
    });

    const findings = [];
    const dominant = [...segments].sort((a, b) => b.share - a.share)[0];
    if (dominant) {
      findings.push({
        type: 'concentration',
        label: `${dominant.value} dominates ${dominant.column}`,
        detail: `${(dominant.share * 100).toFixed(1)}% of records · ${dominant.count.toLocaleString()} rows`,
        action: `Filter to ${dominant.column} = ${dominant.value}`,
        filter: dominant,
        icon: 'sparkle',
      });
    }

    if (numericMetricCol) {
      const leader = [...segments].sort((a, b) => b.metricTotal - a.metricTotal)[0];
      if (leader && leader.metricTotal > 0) {
        findings.push({
          type: 'performance',
          label: `${leader.value} leads ${leader.column}`,
          detail: `${numericMetricCol}: ${Math.round(leader.metricTotal).toLocaleString()} across ${leader.count.toLocaleString()} rows`,
          action: `Ask AI to explain ${leader.value}`,
          prompt: `Explain why ${leader.value} in ${leader.column} contributes the most ${numericMetricCol}. Compare it with the other segments.`,
          icon: 'trend',
        });
      }
    }

    const relationship = relationshipPairs?.[0];
    if (relationship) {
      findings.push({
        type: 'relationship',
        label: `${relationship.valueA} × ${relationship.valueB}`,
        detail: `${relationship.count.toLocaleString()} matching rows · ${relationship.share} of the dataset`,
        action: 'Analyze this relationship',
        prompt: `Analyze the relationship between ${relationship.colA} = '${relationship.valueA}' and ${relationship.colB} = '${relationship.valueB}'. Show the key metrics and how this compares with other combinations.`,
        icon: 'intersect',
      });
    }

    return findings;
  }, [tableData, columns, numericMetricCol, relationshipPairs]);

  // Compute Multi-Node Intersection Stats when two nodes are selected
  const multiNodeIntersection = useMemo(() => {
    if (!selectedNode || !secondNode || !tableData) return null;

    const getColName = (node) => node.column || node.details?.column || (node.type === 'column' ? node.label : null);

    const col1 = getColName(selectedNode);
    const col2 = getColName(secondNode);

    const matches = tableData.filter((r) => {
      let match1 = true;
      let match2 = true;

      if (selectedNode.type === 'value') {
        match1 = col1 ? String(r[col1]) === String(selectedNode.value) : true;
      } else if (col1) {
        match1 = r[col1] != null && r[col1] !== '';
      }

      if (secondNode.type === 'value') {
        match2 = col2 ? String(r[col2]) === String(secondNode.value) : true;
      } else if (col2) {
        match2 = r[col2] != null && r[col2] !== '';
      }

      return match1 && match2;
    });

    let sumMetric = 0;
    if (numericMetricCol) {
      sumMetric = matches.reduce((acc, r) => acc + (Number(r[numericMetricCol]) || 0), 0);
    }

    return {
      count: matches.length,
      percentage: `${((matches.length / tableData.length) * 100).toFixed(1)}%`,
      sumMetric: sumMetric > 0 ? `$${Math.round(sumMetric).toLocaleString()}` : null,
      node1: selectedNode.label,
      node2: secondNode.label,
    };
  }, [selectedNode, secondNode, tableData, numericMetricCol]);

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

      // Draw Background Grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      const gridSize = 40;
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

        const isHighlighted =
          (hoveredNode && (hoveredNode.id === sourceNode.id || hoveredNode.id === targetNode.id)) ||
          (selectedNode && (selectedNode.id === sourceNode.id || selectedNode.id === targetNode.id)) ||
          (secondNode && (secondNode.id === sourceNode.id || secondNode.id === targetNode.id));

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = isHighlighted ? 'rgba(219, 53, 82, 0.85)' : edge.color;
        ctx.lineWidth = isHighlighted ? 2.5 : edge.weight;
        ctx.setLineDash(edge.relationship ? [4, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);

        // Animated flow particles
        if (isPhysicsActive) {
          const time = (Date.now() * 0.0015 + activeNodes.indexOf(sourceNode)) % 1;
          const px = sx + (tx - sx) * time;
          const py = sy + (ty - sy) * time;
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fillStyle = isHighlighted ? '#db3552' : '#ffffff';
          ctx.fill();
        }
      });

      // Draw Multi-Node Link Line if two nodes are selected
      if (selectedNode && secondNode) {
        const n1 = activeNodes.find((n) => n.id === selectedNode.id);
        const n2 = activeNodes.find((n) => n.id === secondNode.id);
        if (n1 && n2) {
          ctx.beginPath();
          ctx.moveTo(n1.x + centerX, n1.y + centerY);
          ctx.lineTo(n2.x + centerX, n2.y + centerY);
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 3;
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Draw Nodes
      activeNodes.forEach((node) => {
        const nx = node.x + centerX;
        const ny = node.y + centerY;

        const isHovered = hoveredNode?.id === node.id;
        const isSelected = selectedNode?.id === node.id;
        const isSecond = secondNode?.id === node.id;
        const isMatchSearch = searchQuery && node.label.toLowerCase().includes(searchQuery.toLowerCase());

        // Aura Rings
        if (viewMode === 'vector' || isHovered || isSelected || isSecond || isMatchSearch) {
          ctx.beginPath();
          ctx.arc(nx, ny, node.radius + (isHovered || isSelected ? 12 : 8), 0, Math.PI * 2);
          ctx.fillStyle = isSecond ? '#10b98133' : `${node.color}22`;
          ctx.fill();
          ctx.strokeStyle = isSecond ? '#10b981' : node.color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Solid Node Circle
        ctx.beginPath();
        ctx.arc(nx, ny, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = isSecond ? '#10b981' : node.color;
        ctx.fill();
        ctx.strokeStyle = isSelected || isSecond ? '#ffffff' : 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = isSelected || isSecond ? 3 : 1.5;
        ctx.stroke();

        // Node Label
        ctx.font = node.type === 'root' ? 'bold 12px "Space Mono", monospace' : '10px "Space Mono", monospace';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, nx, ny + node.radius + 14);
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [edges, viewMode, isPhysicsActive, hoveredNode, selectedNode, secondNode, searchQuery]);

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

      // Handle Node Selection (Single or Dual Node Intersection Mode)
      if (e.shiftKey || selectedNode) {
        if (selectedNode && selectedNode.id !== node.id) {
          setSecondNode(node);
        } else {
          setSelectedNode(node);
          setSecondNode(null);
        }
      } else {
        setSelectedNode(node);
        setSecondNode(null);
      }
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

  return (
    <div className="flex h-full w-full bg-[#161214] text-white relative overflow-hidden select-none">

      {/* Top Floating Control Bar */}
      <div className="absolute top-4 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-3 bg-black/70 backdrop-blur-md border border-white/10 p-3 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ShareNetwork size={18} className="text-[var(--color-accent)]" />
            <h3 className="text-xs font-mono font-bold tracking-tight">KNOWLEDGE GRAPH & VECTORS</h3>
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
              className="bg-white/5 border border-white/10 text-xs font-mono pl-8 pr-3 py-1.5 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-[var(--color-accent)] w-40 sm:w-48"
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

          <button
            onClick={() => setShowIntelPanel(!showIntelPanel)}
            className={`p-2 rounded-lg border text-xs font-mono font-bold flex items-center gap-1 cursor-pointer transition-all ${
              showIntelPanel ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white' : 'bg-white/5 border-white/10 text-zinc-300 hover:text-white'
            }`}
            title="Toggle Graph Intelligence Panel"
          >
            <TrendUp size={13} />
            <span>Intel</span>
            <span className="rounded bg-white/15 px-1.5 py-0.5 text-[9px] text-emerald-300">{graphFindings.length}</span>
          </button>

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
            <Play size={13} className={isPhysicsActive ? 'text-emerald-400' : ''} />
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

        {/* Floating Helper Banner */}
        <div className="absolute bottom-4 left-4 z-10 text-[10px] font-mono text-zinc-400 bg-black/70 border border-white/10 px-3 py-1.5 rounded-lg flex items-center gap-3">
          <span>💡 Shift+Click 2 nodes for Intersection Analysis</span>
          <span>•</span>
          <span>Drag nodes to organize</span>
          <span>•</span>
          <span>Click node for actions</span>
        </div>
      </div>

      {/* Graph Intelligence Side Panel Drawer */}
      {showIntelPanel && (
        <div className="w-80 h-full border-l border-white/10 bg-[#191316] p-5 z-20 flex flex-col space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <TrendUp size={16} className="text-[var(--color-accent)]" />
              <h4 className="text-xs font-mono font-bold text-white uppercase">Graph Intelligence</h4>
            </div>
            <button onClick={() => setShowIntelPanel(false)} className="text-zinc-400 hover:text-white cursor-pointer">
              <X size={14} />
            </button>
          </div>

          <div className="space-y-4 text-xs font-mono">
            {/* Actionable Findings */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-zinc-400 uppercase font-bold">What the graph reveals</p>
                <span className="text-[9px] text-emerald-400">evidence-based</span>
              </div>
              {graphFindings.length > 0 ? graphFindings.map((finding, index) => {
                const FindingIcon = finding.icon === 'trend' ? TrendUp : finding.icon === 'intersect' ? Intersect : Sparkle;
                return (
                  <div key={`${finding.type}-${index}`} className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <FindingIcon size={15} className="text-emerald-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] text-white font-bold leading-snug">{finding.label}</p>
                        <p className="text-[10px] text-zinc-400 leading-relaxed mt-1">{finding.detail}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {finding.filter && onFilterTable && (
                        <button
                          onClick={() => onFilterTable(finding.filter.column, finding.filter.value)}
                          className="flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[9px] text-zinc-200 hover:bg-white/10 cursor-pointer transition-colors"
                        >
                          <Table size={11} className="inline mr-1" />
                          Filter rows
                        </button>
                      )}
                      {finding.prompt && onExecuteQuery && (
                        <button
                          onClick={() => onExecuteQuery(finding.prompt)}
                          className="flex-1 rounded-md bg-[var(--color-accent)] px-2 py-1.5 text-[9px] text-white hover:opacity-90 cursor-pointer transition-opacity"
                        >
                          <Lightning size={11} className="inline mr-1" />
                          {finding.action}
                        </button>
                      )}
                    </div>
                  </div>
                );
              }) : (
                <p className="text-[10px] text-zinc-500 leading-relaxed">Add more categorical or numeric fields to surface relationships and performance signals.</p>
              )}
            </div>

            {/* Hub Centrality */}
            <div className="card p-3 bg-white/5 border-white/10 space-y-2">
              <p className="text-[10px] text-zinc-400 uppercase font-bold">Most informative fields</p>
              {hubStats.map((h, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-white font-bold">{h.name}</span>
                  <span className="text-zinc-400 text-[10px]">{h.connections} values · {h.coverage}</span>
                </div>
              ))}
            </div>

            {/* Most common values */}
            <div className="card p-3 bg-white/5 border-white/10 space-y-2">
              <p className="text-[10px] text-zinc-400 uppercase font-bold">Most common values</p>
              {topPairs.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-emerald-400 font-bold truncate max-w-[170px]">{p.entity}</span>
                  <span className="text-white bg-white/10 px-1.5 py-0.2 rounded text-[10px]">{p.share}</span>
                </div>
              ))}
            </div>

            {/* Cross-column relationships */}
            {relationshipPairs.length > 0 && (
              <div className="card p-3 bg-emerald-500/5 border-emerald-500/20 space-y-2">
                <p className="text-[10px] text-zinc-400 uppercase font-bold">Strongest relationships</p>
                {relationshipPairs.slice(0, 3).map((pair, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="text-zinc-200 truncate">{pair.valueA} <span className="text-emerald-400">×</span> {pair.valueB}</span>
                    <span className="text-emerald-400 shrink-0">{pair.share}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Node Inspector & Multi-Node Intersection Card */}
      {selectedNode && (
        <div className="w-80 h-full border-l border-white/10 bg-[#1d181a] p-5 z-20 flex flex-col space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full" style={{ background: selectedNode.color }} />
              <h4 className="text-xs font-mono font-bold text-white uppercase truncate max-w-[180px]">{selectedNode.label}</h4>
            </div>
            <button onClick={() => { setSelectedNode(null); setSecondNode(null); }} className="text-zinc-400 hover:text-white cursor-pointer">
              <X size={14} />
            </button>
          </div>

          {/* Dual-Node Intersection Card */}
          {multiNodeIntersection && (
            <div className="card p-3 bg-emerald-500/10 border-emerald-500/30 space-y-2">
              <div className="flex items-center gap-1.5 text-emerald-400 text-[10px] font-mono font-bold uppercase">
                <Intersect size={14} />
                <span>Multi-Node Intersection</span>
              </div>
              <p className="text-[11px] font-mono text-zinc-300">
                Overlap: <span className="text-white font-bold">{multiNodeIntersection.node1}</span> ∩ <span className="text-white font-bold">{multiNodeIntersection.node2}</span>
              </p>
              <div className="flex items-center justify-between text-[11px] font-mono pt-1">
                <span className="text-zinc-400">Matching Rows:</span>
                <span className="text-emerald-400 font-bold">{multiNodeIntersection.count} ({multiNodeIntersection.percentage})</span>
              </div>
              {multiNodeIntersection.sumMetric && (
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-zinc-400">Total Revenue:</span>
                  <span className="text-emerald-400 font-bold">{multiNodeIntersection.sumMetric}</span>
                </div>
              )}
            </div>
          )}

          {/* Node Metadata & Action Toolkit */}
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
                      ? `Show detailed analysis and total revenue for ${selectedNode.column} '${selectedNode.value}'`
                      : `Analyze distribution and key trends for ${selectedNode.label}`;
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
