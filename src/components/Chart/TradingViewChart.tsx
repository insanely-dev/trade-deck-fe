/** eslint-disable */
import React, { useEffect, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type Time,
} from "lightweight-charts";
import useStore from "../../store/store";
import { toast } from "sonner";
import { API_URL } from "../../config/config";
import axios from "axios";
import cookies from "js-cookie";

interface TradingViewChartProps {
  symbol: string;
  timeframe: string;
  chartType: "line" | "candlestick";
  tradeId: string;
  chartData: CandlestickData[];
  isLoading: boolean;
  onRefreshData: () => void;
}

const TradingViewChart: React.FC<TradingViewChartProps> = ({
  tradeId,
  chartType = "candlestick",
  chartData,
  isLoading,
  onRefreshData,
}) => {
  const { trades, optionValues } = useStore();
  const trade = trades.find((t) => t.id === tradeId);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<
    Record<
      string,
      ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null
    >
  >({});
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const [cursor, setCursor] = useState("default");

  const isDraggingRef = useRef(false);
  const draggingLineTypeRef = useRef<"limit" | "sl" | "tp" | null>(null);
  const lastCandleDataRef = useRef<{
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null>(null);

  const [chartReady, setChartReady] = useState(false);

  const [qty, setQty] = useState(1);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [slPoints, setSlPoints] = useState(5);
  const [tpPoints, setTpPoints] = useState(5);

  // @ts-expect-error "fix"
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const keys = ["limit", "sl", "tp"] as const;
  type LineType = (typeof keys)[number];

  const debouncedUpdatePrice = (type: LineType, price: number) => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      updatePriceOnBackend(type, price);
    }, 500);
  };

  const updatePriceOnBackend = async (type: LineType, price: number) => {
    if (!trade) return;

    try {
      const DATA: {
        entryPrice: number;
        stopLossPremium: number;
        takeProfitPremium: number;
        stopLossPoints: number;
        takeProfitPoints: number;
      } = {
        entryPrice: trade.entryPrice,
        stopLossPremium: trade.stopLossPremium,
        takeProfitPremium: trade.takeProfitPremium,
        stopLossPoints: trade.stopLossPoints,
        takeProfitPoints: trade.takeProfitPoints,
      };

      if (type === "limit") {
        if (trade.entrySide === "SELL") {
          DATA.stopLossPoints = parseFloat(
            (trade.stopLossPremium - price).toFixed(2)
          );
          DATA.takeProfitPoints = parseFloat(
            (price - trade.takeProfitPremium).toFixed(2)
          );
        }

        if (trade.entrySide === "BUY") {
          DATA.stopLossPoints = parseFloat(
            (price - trade.stopLossPremium).toFixed(2)
          );
          DATA.takeProfitPoints = parseFloat(
            (trade.takeProfitPremium - price).toFixed(2)
          );
        }

        DATA.entryPrice = parseFloat(price.toFixed(2));
      } else if (type === "sl") {
        if (trade.entrySide === "BUY") {
          DATA.stopLossPoints = parseFloat(
            (trade.entryPrice - price).toFixed(2)
          );
          if (price >= trade.entryPrice) {
            toast.error("SL price should be less than the limit price");
            return;
          }
        }
        if (trade.entrySide === "SELL") {
          DATA.stopLossPoints = parseFloat(
            (price - trade.entryPrice).toFixed(2)
          );
          if (price <= trade.entryPrice) {
            toast.error("SL price should be greater than the limit price");
            return;
          }
        }
        DATA.stopLossPremium = parseFloat(price.toFixed(2));
      } else if (type === "tp") {
        if (trade.entrySide === "BUY") {
          DATA.takeProfitPoints = parseFloat(
            (price - trade.entryPrice).toFixed(2)
          );
          if (price <= trade.entryPrice) {
            toast.error("TP price should be greater than the limit price");
            return;
          }
        }
        if (trade.entrySide === "SELL") {
          DATA.takeProfitPoints = parseFloat(
            (trade.entryPrice - price).toFixed(2)
          );
          if (price >= trade.entryPrice) {
            toast.error("SL price should be greater than the limit price");
            return;
          }
        }
        DATA.takeProfitPremium = parseFloat(price.toFixed(2));
      }
      const token = cookies.get("auth");

      await axios.put(API_URL + "/user/tradeInfo", DATA, {
        headers: { Authorization: "Bearer " + token },
        params: { id: trade.id },
      });

      toast.success(`${type.toUpperCase()} price updated`);
    } catch (error) {
      console.error(error);
      toast.error("Error updating price");
    }
  };

  const transformDataForChartType = (
    rawData: CandlestickData[]
  ): CandlestickData[] | LineData[] => {
    if (chartType === "line") {
      return rawData.map((candle: any) => ({
        time: candle.time,
        value: candle.close,
      }));
    }
    return rawData;
  };

  const removePriceLines = () => {
    keys.forEach((key) => {
      if (priceLinesRef.current[key]) {
        const series = candleSeriesRef.current || lineSeriesRef.current;
        series?.removePriceLine(priceLinesRef.current[key]!);
        priceLinesRef.current[key] = null;
      }
    });
  };

  const createPriceLines = (prices: {
    limit: number;
    sl: number;
    tp: number;
  }) => {
    const series = candleSeriesRef.current || lineSeriesRef.current;
    if (!series) return;

    removePriceLines();

    if (trade?.entryType === "UNDEFINED" && orderType === "market") {
      return;
    }

    keys.forEach((key) => {
      const price = prices[key];
      if (typeof price !== "number" || isNaN(price)) {
        console.warn(`Invalid price for ${key}:`, price);
        return;
      }

      priceLinesRef.current[key] = series.createPriceLine({
        price: price,
        color: key === "sl" ? "#ef5350" : key === "tp" ? "#26a69a" : "#2962FF",
        lineWidth: 2,
        axisLabelVisible: true,
        title: `${key.toUpperCase()} (${price.toFixed(2)})`,
        lineStyle: 0,
      });
    });
  };

  // Live data updates
  useEffect(() => {
    if (!chartReady) return;

    const series = candleSeriesRef.current || lineSeriesRef.current;
    if (!series) return;

    const liveValue = optionValues.find(
      (t) => t.id === tradeId
    )?.lowestCombinedPremium;

    if (liveValue === undefined || liveValue === null) return;

    const currentTimeGMTSeconds = Math.floor(Date.now() / 1000);
    const candleTime = currentTimeGMTSeconds - (currentTimeGMTSeconds % 60);

    if (chartType === "candlestick") {
      if (
        !lastCandleDataRef.current ||
        lastCandleDataRef.current.time !== candleTime
      ) {
        lastCandleDataRef.current = {
          time: candleTime as Time,
          open: liveValue,
          high: liveValue,
          low: liveValue,
          close: liveValue,
        };
      } else {
        lastCandleDataRef.current.high = Math.max(
          lastCandleDataRef.current.high,
          liveValue
        );
        lastCandleDataRef.current.low = Math.min(
          lastCandleDataRef.current.low,
          liveValue
        );
        lastCandleDataRef.current.close = liveValue;
      }

      (series as ISeriesApi<"Candlestick">).update(lastCandleDataRef.current);
    } else {
      (series as ISeriesApi<"Line">).update({
        time: currentTimeGMTSeconds as Time,
        value: liveValue,
      });
    }
  }, [chartReady, optionValues, tradeId, chartType]);

  // Chart initialization
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;
    let chart: IChartApi | null = null;

    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (entry.isIntersecting) {
          chart = createChart(container, {
            width: container.clientWidth,
            height: container.clientHeight,
            layout: { background: { color: "#1f2937" }, textColor: "#d1d5db" },
            grid: {
              vertLines: { visible: false, color: "#374151" },
              horzLines: { visible: true, color: "#374151" },
            },
            timeScale: { timeVisible: true },
            crosshair: { mode: 1 },
            handleScale: {
              axisPressedMouseMove: { time: true, price: false },
              mouseWheel: true,
              pinch: true,
            },
            handleScroll: {
              mouseWheel: true,
              horzTouchDrag: true,
              vertTouchDrag: true,
            },
          });

          if (!chart) {
            console.error("Failed to create chart instance");
            return;
          }

          chartRef.current = chart;
          setChartReady(true);

          const resizeChart = () => {
            if (chartRef.current && chartContainerRef.current) {
              const rect = chartContainerRef.current.getBoundingClientRect();
              chartRef.current.applyOptions({
                width: rect.width,
                height: rect.height,
              });
              chartRef.current.timeScale().fitContent();
            }
          };

          resizeObserverRef.current = new ResizeObserver(() =>
            requestAnimationFrame(resizeChart)
          );
          resizeObserverRef.current.observe(container);

          setTimeout(resizeChart, 100);
          observer.unobserve(container);
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
      resizeObserverRef.current?.disconnect();

      if (chart) {
        try {
          chart.remove();
        } catch (error) {
          console.warn("Chart disposal error:", error);
        }
        chart = null;
      }

      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      setChartReady(false);
    };
  }, [chartContainerRef.current]);

  // Update chart when data or chart type changes
  useEffect(() => {
    if (!chartRef.current || !chartReady || !chartData.length) return;

    // Remove existing series
    if (candleSeriesRef.current) {
      chartRef.current.removeSeries(candleSeriesRef.current);
      candleSeriesRef.current = null;
    }
    if (lineSeriesRef.current) {
      chartRef.current.removeSeries(lineSeriesRef.current);
      lineSeriesRef.current = null;
    }

    // Transform data and create new series
    const transformedData = transformDataForChartType(chartData);

    if (chartType === "candlestick") {
      const candleSeries = chartRef.current.addCandlestickSeries({
        upColor: "#10b981",
        downColor: "#ef4444",
        borderDownColor: "#ef4444",
        borderUpColor: "#10b981",
        wickDownColor: "#ef4444",
        wickUpColor: "#10b981",
      });
      candleSeries.setData(transformedData as CandlestickData[]);
      candleSeriesRef.current = candleSeries;
      
      // Initialize lastCandleDataRef with the last data point for candlestick charts
      if (transformedData.length > 0) {
        const lastCandle = transformedData[transformedData.length - 1] as CandlestickData;
        lastCandleDataRef.current = {
          time: lastCandle.time,
          open: lastCandle.open,
          high: lastCandle.high,
          low: lastCandle.low,
          close: lastCandle.close,
        };
      }
    } else {
      const lineSeries = chartRef.current.addLineSeries({
        color: "#3b82f6",
        lineWidth: 2,
      });
      lineSeries.setData(transformedData as LineData[]);
      lineSeriesRef.current = lineSeries;
      
      // Reset lastCandleDataRef for line charts as it's not relevant
      lastCandleDataRef.current = null;
    }

    chartRef.current.timeScale().fitContent();
  }, [chartData, chartType, chartReady]);

  useEffect(() => {
    if (!chartReady) return;
    const container = chartContainerRef.current;
    if (!container || (!candleSeriesRef.current && !lineSeriesRef.current))
      return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;

      let nearest: LineType | null = null;
      let minDistance = Infinity;

      const series = candleSeriesRef.current || lineSeriesRef.current;
      if (!series) return;

      keys.forEach((key) => {
        const line = priceLinesRef.current[key];
        if (!line) return;
        const coord = series.priceToCoordinate(line.options().price);
        if (coord === undefined || coord === null) return;
        const dist = Math.abs(y - coord);
        if (dist < 10 && dist < minDistance) {
          nearest = key;
          minDistance = dist;
        }
      });

      if (isDraggingRef.current && draggingLineTypeRef.current) {
        const newPrice = series.coordinateToPrice(y);
        if (newPrice !== null && newPrice !== undefined) {
          priceLinesRef.current[draggingLineTypeRef.current]?.applyOptions({
            price: newPrice,
            title: `${draggingLineTypeRef.current.toUpperCase()} (${newPrice.toFixed(
              2
            )})`,
          });
        }
        setCursor("grabbing");
      } else {
        setCursor(nearest ? "grab" : "default");
        draggingLineTypeRef.current = nearest;
      }
    };

    const handleMouseDown = () => {
      if (!draggingLineTypeRef.current) return;

      const lineType = draggingLineTypeRef.current;
      let canDrag = false;

      if (!trade || trade.entryType === "UNDEFINED") canDrag = true;
      else if (trade.entryType === "LIMIT" && !trade.entryTriggered)
        canDrag = true;
      else if (
        ["LIMIT", "MARKET"].includes(trade.entryType) &&
        trade.entryTriggered
      )
        canDrag = lineType === "sl" || lineType === "tp";

      if (!canDrag) {
        setCursor("not-allowed");
        return;
      }

      isDraggingRef.current = true;
      setCursor("grabbing");
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        const lineType = draggingLineTypeRef.current;

        if (lineType) {
          const updatedPrice = priceLinesRef.current[lineType]?.options().price;

          if (updatedPrice !== undefined && updatedPrice !== null) {
            debouncedUpdatePrice(lineType, updatedPrice);
          }
        }
      }
      isDraggingRef.current = false;
      setCursor("default");
    };

    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mousedown", handleMouseDown);
    container.addEventListener("mouseup", handleMouseUp);

    return () => {
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mousedown", handleMouseDown);
      container.removeEventListener("mouseup", handleMouseUp);
    };
  }, [trade, orderType, chartReady, chartType]);

  useEffect(() => {
    if (!chartData.length || !trade || chartData.length === 0) return;

    // Get the last price with proper fallback handling
    let lastPrice = 0; // Default fallback value

    if (chartData.length > 0) {
      const lastDataPoint = chartData[chartData.length - 1];

      if (chartType === "candlestick") {
        const candleData = lastDataPoint as CandlestickData;
        lastPrice = typeof candleData.close === "number" ? candleData.close : 0;
      } else {
        // @ts-expect-error "fix"

        const lineData = lastDataPoint as LineData;
        lastPrice = typeof lineData.value === "number" ? lineData.value : 0;
      }
    }

    const updatedLines = {
      limit:
        trade.entryPrice && trade.entryPrice !== 0
          ? trade.entryPrice
          : lastPrice,
      sl:
        trade.stopLossPremium && trade.stopLossPremium !== 0
          ? trade.stopLossPremium
          : lastPrice,
      tp:
        trade.takeProfitPremium && trade.takeProfitPremium !== 0
          ? trade.takeProfitPremium
          : lastPrice,
    };

    createPriceLines(updatedLines);
  }, [trade, orderType, chartType, chartData]);

  const placeOrder = async () => {
    if (!trade) return;

    if (!qty) {
      toast.warning("Qty is required");
      return;
    }

    const token = cookies.get("auth");

    let limitPrice = priceLinesRef.current.limit?.options().price;
    let slPrice = priceLinesRef.current.sl?.options().price;
    let tpPrice = priceLinesRef.current.tp?.options().price;

    console.log(priceLinesRef.current);
    if ((!limitPrice || !slPrice || !tpPrice) && orderType === "limit") return;

    if (orderType === "market") {
      await axios.put(
        API_URL + "/user/tradeInfo",
        {
          entryType: "MARKET",
          stopLossPoints: slPoints,
          takeProfitPoints: tpPoints,
          qty,
        },
        {
          headers: { Authorization: "Bearer " + token },
          params: { id: trade.id },
        }
      );
    }

    if (orderType === "limit" && limitPrice && slPrice && tpPrice) {
      limitPrice = parseFloat(limitPrice.toFixed(2));
      slPrice = parseFloat(slPrice.toFixed(2));
      tpPrice = parseFloat(tpPrice.toFixed(2));
      let getTpPoints;
      let getSlPoints;
      if (trade.entrySide === "SELL") {
        if (trade.takeProfitPremium >= trade.entryPrice) {
          toast.warning("take profit cannot be greater than the limit price");
          return;
        }
        if (trade.stopLossPremium <= trade.entryPrice) {
          toast.warning("stopLoss cannot be less than the limit price");
          return;
        }
        getTpPoints = limitPrice - tpPrice;
        getSlPoints = slPrice - limitPrice;
      }
      if (trade.entrySide === "BUY") {
        if (trade.takeProfitPremium <= trade.entryPrice) {
          toast.warning("take profit cannot be less then the limit price");
          return;
        }
        if (trade.stopLossPremium >= trade.entryPrice) {
          toast.warning("stop loss cannot be greater than the limit price");
        }
        getTpPoints = tpPrice - limitPrice;
        getSlPoints = limitPrice - slPrice;
      }
      await axios.put(
        API_URL + "/user/tradeInfo",
        {
          entryType: "LIMIT",
          entryPrice: limitPrice,
          stopLossPremium: slPrice,
          takeProfitPremium: tpPrice,
          stopLossPoints: getSlPoints,
          takeProfitPoints: getTpPoints,
        },
        {
          headers: { Authorization: "Bearer " + token },
          params: { id: trade.id },
        }
      );
    }

    toast.success("Order placed successfully");
  };

  const scrollDownside = () => {
    if (!chartRef.current) return;

    const priceScale = chartRef.current.priceScale("right");
    const currentMargins = priceScale.options().scaleMargins;

    if (!currentMargins) return;

    const newTop = Math.min(currentMargins.top + 0.05, 0.8);
    const newBottom = Math.max(currentMargins.bottom - 0.05, 0.1);

    priceScale.applyOptions({
      scaleMargins: {
        top: newTop,
        bottom: newBottom,
      },
    });
  };

  const scrollUpside = () => {
    if (!chartRef.current) return;

    const priceScale = chartRef.current.priceScale("right");
    const currentMargins = priceScale.options().scaleMargins;

    if (!currentMargins) return;

    const newTop = Math.max(currentMargins.top - 0.05, 0.1);
    const newBottom = Math.min(currentMargins.bottom + 0.05, 0.8);

    priceScale.applyOptions({
      scaleMargins: {
        top: newTop,
        bottom: newBottom,
      },
    });
  };

  const resetMargins = () => {
    if (!chartRef.current) return;

    chartRef.current.priceScale("right").applyOptions({
      scaleMargins: { top: 0.2, bottom: 0.2 },
    });
  };

  if (!trade)
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Trade not found
      </div>
    );

  if (isLoading && !chartData.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 border border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Loading chart data...</span>
        </div>
      </div>
    );
  }

  if (!chartData.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <p>No chart data available</p>
          <button
            onClick={onRefreshData}
            className="mt-2 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={chartContainerRef}
      className="w-full h-full relative"
      style={{ cursor }}
    >
      <div className="z-20 absolute top-10 right-20 flex space-x-2">
        <button
          onClick={scrollUpside}
          className="px-1 py-1 text-xs cursor-pointer bg-green-600 text-white rounded hover:bg-green-700"
        >
          ↑
        </button>
        <button
          onClick={scrollDownside}
          className="px-1 py-1 text-xs cursor-pointer bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          ↓
        </button>
        <button
          onClick={resetMargins}
          className="text-xs px-1 py-1 cursor-pointer bg-yellow-600 text-white rounded hover:bg-yellow-700"
        >
          Reset
        </button>
      </div>
      {trade.entryType === "UNDEFINED" && (
        <div className="absolute top-10 left-2 bg-gray-700 border border-gray-600 p-2 rounded-xl z-20 text-white text-xs">
          <div className="mb-2">
            <label className="block mb-1">Qty:</label>
            <input
              className="border rounded px-1 py-0.5 w-16 bg-gray-800 text-white"
              type="number"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
            />
          </div>
          <div className="mb-2">
            <label className="block mb-1">
              <input
                type="radio"
                checked={orderType === "limit"}
                onChange={() => setOrderType("limit")}
                className="mr-1"
              />
              Limit
            </label>
            <label className="block">
              <input
                type="radio"
                checked={orderType === "market"}
                onChange={() => setOrderType("market")}
                className="mr-1"
              />
              Market
            </label>
          </div>

          {orderType === "market" && (
            <div className="mb-2">
              <div className="mb-1">
                <label className="block text-xs">SL (pts):</label>
                <input
                  type="number"
                  value={slPoints}
                  onChange={(e) => setSlPoints(Number(e.target.value))}
                  className="w-12 px-1 py-0.5 border border-gray-500 bg-gray-800 text-white rounded"
                />
              </div>
              <div className="mb-1">
                <label className="block text-xs">TP (pts):</label>
                <input
                  type="number"
                  value={tpPoints}
                  onChange={(e) => setTpPoints(Number(e.target.value))}
                  className="w-12 px-1 py-0.5 border border-gray-500 bg-gray-800 text-white rounded"
                />
              </div>
            </div>
          )}

          <button
            onClick={placeOrder}
            className="mt-1 bg-blue-600 text-white px-2 py-1 rounded text-xs hover:bg-blue-700 font-medium w-full"
          >
            Place Order
          </button>
        </div>
      )}
    </div>
  );
};

export default TradingViewChart;
