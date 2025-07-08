import React, { useState, useEffect } from "react";
import { Plus, X, Grid3X3, Grid2X2, LayoutGrid } from "lucide-react";
import TradingViewChart from "./TradingViewChart";
import useStore from "../../store/store";
import type { Trade } from "../../types/trade";
import { API_URL } from "../../config/config";
import axios from "axios";
import cookies from "js-cookie";
import { toast } from "sonner";
import type { CandlestickData } from "lightweight-charts";

interface ChartTab {
  id: string;
  tradeId: string;
  symbol: string;
  expiry: string;
  range: number;
  timeframe: string;
  chartType: "candlestick" | "line";
}

type LayoutType = "single" | "2x2" | "3x1" | "2x2-grid";

interface ChartData {
  [tradeId: string]: CandlestickData[];
}

const ChartContainer: React.FC = () => {
  const { trades } = useStore();

  // Chart data state - no more caching, fresh data every time
  const [chartData, setChartData] = useState<ChartData>({});
  const [isLoading, setIsLoading] = useState<{ [tradeId: string]: boolean }>(
    {}
  );

  // Initialize tabs with the first trade if available
  const [tabs, setTabs] = useState<ChartTab[]>(() => {
    const filteredTrade = trades.filter((each) => each.alive === true);
    if (filteredTrade.length > 0) {
      const firstTrade = filteredTrade[0];
      return [
        {
          id: "1",
          tradeId: firstTrade.id,
          symbol: firstTrade.indexName,
          expiry: firstTrade.expiry,
          range: firstTrade.ltpRange,
          timeframe: "1m",
          chartType: "candlestick",
        },
      ];
    }
    return [
      {
        id: "1",
        tradeId: "",
        symbol: "select",
        expiry: "",
        range: 0,
        timeframe: "1m",
        chartType: "candlestick",
      },
    ];
  });

  const [activeTab, setActiveTab] = useState("1");
  const [layout, setLayout] = useState<LayoutType>("single");

  // Function to fetch candle data for a specific trade
  const fetchCandleData = async (
    tradeId: string
  ): Promise<CandlestickData[]> => {
    const trade = trades.find((t) => t.id === tradeId);
    if (!trade) return [];

    try {
      setIsLoading((prev) => ({ ...prev, [tradeId]: true }));

      const token = cookies.get("auth");
      const response = await axios.get(API_URL + "/user/candle/", {
        headers: { Authorization: "Bearer " + token },
        params: {
          indexName: trade.indexName,
          expiryDate: trade.expiry,
          range: trade.ltpRange,
        },
      });

      const candleData = response.data.data;
      if (!candleData || candleData.length === 0) return [];

      // Convert time property to Unix timestamp in seconds for lightweight-charts
      return candleData.map((candle: any) => ({
        ...candle,
        time: typeof candle.time === 'object' && candle.time instanceof Date
          ? Math.floor(candle.time.getTime() / 1000)
          : typeof candle.time === 'string'
          ? Math.floor(new Date(candle.time).getTime() / 1000)
          : typeof candle.time === 'number'
          ? candle.time > 1000000000000 // If timestamp is in milliseconds
            ? Math.floor(candle.time / 1000)
            : candle.time
          : Math.floor(Date.now() / 1000) // Fallback to current time
      }));
    } catch (error) {
      console.error("Error fetching chart data:", error);
      toast.error("Failed to fetch chart data");
      return [];
    } finally {
      setIsLoading((prev) => ({ ...prev, [tradeId]: false }));
    }
  };

  // Function to update chart data for a specific trade
  const updateChartData = async (tradeId: string) => {
    if (!tradeId) return;

    const data = await fetchCandleData(tradeId);
    setChartData((prev) => ({
      ...prev,
      [tradeId]: data,
    }));
  };

  // Update tabs when trades change
  useEffect(() => {
    const filteredTrade = trades.filter((each) => each.alive === true);
    if (filteredTrade.length > 0 && tabs.length > 0 && tabs[0].tradeId === "") {
      const firstTrade = filteredTrade[0];
      const newTab = {
        id: "1",
        tradeId: firstTrade.id,
        symbol: firstTrade.indexName,
        expiry: firstTrade.expiry,
        range: firstTrade.ltpRange,
        timeframe: "1m",
        chartType: "candlestick" as const,
      };
      setTabs([newTab]);
      // Fetch data for the new trade
      updateChartData(firstTrade.id);
    }
  }, [trades]);

  // Periodic data refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      // Get all unique trade IDs from visible tabs
      const visibleTabs = getVisibleTabs();
      const uniqueTradeIds = [
        ...new Set(visibleTabs.map((tab) => tab.tradeId).filter((id) => id)),
      ];

      // Fetch fresh data for all visible trades
      uniqueTradeIds.forEach((tradeId) => {
        updateChartData(tradeId);
      });
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [tabs, layout]);

  // Initial data fetch when tabs change
  useEffect(() => {
    const visibleTabs = getVisibleTabs();
    const uniqueTradeIds = [
      ...new Set(visibleTabs.map((tab) => tab.tradeId).filter((id) => id)),
    ];

    uniqueTradeIds.forEach((tradeId) => {
      if (!chartData[tradeId]) {
        updateChartData(tradeId);
      }
    });
  }, [tabs, layout]);

  const addNewTab = () => {
    const filteredTrade = trades.filter((each) => each.alive === true);

    const newTab: ChartTab = {
      id: Date.now().toString(),
      tradeId: filteredTrade.length > 0 ? filteredTrade[0].id : "",
      symbol: filteredTrade.length > 0 ? filteredTrade[0].indexName : "select",
      expiry: filteredTrade.length > 0 ? filteredTrade[0].expiry : "",
      range: filteredTrade.length > 0 ? filteredTrade[0].ltpRange : 0,
      timeframe: "1m",
      chartType: "candlestick",
    };
    setTabs([...tabs, newTab]);
    setActiveTab(newTab.id);

    // Fetch data for the new tab if it has a valid trade
    if (newTab.tradeId) {
      updateChartData(newTab.tradeId);
    }
  };

  const closeTab = (tabId: string) => {
    if (tabs.length === 1) return;

    const newTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(newTabs);

    if (activeTab === tabId) {
      setActiveTab(newTabs[0].id);
    }
  };

  const updateTab = (tabId: string, updates: Partial<ChartTab>) => {
    setTabs(
      tabs.map((tab) => (tab.id === tabId ? { ...tab, ...updates } : tab))
    );
  };

  const handleTradeChange = (tabId: string, tradeId: string) => {
    const selectedTrade = trades.find((trade) => trade.id === tradeId);
    if (selectedTrade) {
      updateTab(tabId, {
        tradeId: selectedTrade.id,
        symbol: selectedTrade.indexName,
        expiry: selectedTrade.expiry,
        range: selectedTrade.ltpRange,
      });

      // Fetch data for the newly selected trade
      updateChartData(selectedTrade.id);
    }
  };

  const getVisibleTabs = () => {
    switch (layout) {
      case "single":
        return tabs.filter((tab) => tab.id === activeTab);
      case "2x2":
        return tabs.slice(0, 2);
      case "3x1":
        return tabs.slice(0, 3);
      case "2x2-grid":
        return tabs.slice(0, 4);
      default:
        return tabs.filter((tab) => tab.id === activeTab);
    }
  };

  const getLayoutClasses = () => {
    switch (layout) {
      case "single":
        return "grid grid-cols-1 gap-1";
      case "2x2":
        return "grid grid-cols-2 gap-1";
      case "3x1":
        return "grid grid-cols-3 gap-1";
      case "2x2-grid":
        return "grid grid-cols-2 grid-rows-2 gap-1";
      default:
        return "grid grid-cols-1 gap-1";
    }
  };

  const formatTradeOption = (trade: Trade) => {
    return `${trade.indexName}-${trade.expiry}-${trade.ltpRange}`;
  };

  const getTabTitle = (tab: ChartTab) => {
    if (!tab.symbol || tab.symbol === "select") return "Select Symbol";
    return `${tab.symbol}-${tab.expiry}-${tab.range}`;
  };

  return (
    <div className="h-full flex flex-col bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
      {/* Tab Bar */}
      <div className="flex items-center bg-gray-800 border-b border-gray-700 rounded-t-lg">
        <div className="flex-1 flex items-center overflow-x-auto">
          {layout === "single" &&
            tabs.map((tab) => (
              <div
                key={tab.id}
                className={`flex items-center space-x-2 px-3 py-2 border-r border-gray-700 cursor-pointer min-w-0 ${
                  activeTab === tab.id
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-750"
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="text-sm font-medium truncate">
                  {getTabTitle(tab)}
                </span>
                {isLoading[tab.tradeId] && (
                  <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                )}
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="text-gray-500 hover:text-white"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
        </div>

        <div className="flex items-center space-x-1 px-2">
          {/* Layout Options */}
          <div className="flex bg-gray-700 rounded">
            <button
              onClick={() => setLayout("single")}
              className={`p-1 rounded-l ${
                layout === "single"
                  ? "bg-blue-500 text-white"
                  : "text-gray-300 hover:text-white"
              }`}
              title="Single Chart"
            >
              <div className="w-4 h-4 border border-current"></div>
            </button>
            <button
              onClick={() => setLayout("2x2")}
              className={`p-1 ${
                layout === "2x2"
                  ? "bg-blue-500 text-white"
                  : "text-gray-300 hover:text-white"
              }`}
              title="2 Charts"
            >
              <Grid2X2 size={16} />
            </button>
            <button
              onClick={() => setLayout("3x1")}
              className={`p-1 ${
                layout === "3x1"
                  ? "bg-blue-500 text-white"
                  : "text-gray-300 hover:text-white"
              }`}
              title="3 Charts"
            >
              <Grid3X3 size={16} />
            </button>
            <button
              onClick={() => setLayout("2x2-grid")}
              className={`p-1 rounded-r ${
                layout === "2x2-grid"
                  ? "bg-blue-500 text-white"
                  : "text-gray-300 hover:text-white"
              }`}
              title="4 Charts Grid"
            >
              <LayoutGrid size={16} />
            </button>
          </div>

          <button
            onClick={addNewTab}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
            title="Add new chart"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Chart Controls - Only show for single layout */}
      {layout === "single" && tabs.find((tab) => tab.id === activeTab) && (
        <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
          <div className="flex items-center space-x-4">
            <select
              value={tabs.find((tab) => tab.id === activeTab)?.tradeId || ""}
              onChange={(e) => handleTradeChange(activeTab, e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {trades.map((trade) =>
                trade.alive ? (
                  <option key={trade.id} value={trade.id}>
                    {formatTradeOption(trade)}
                  </option>
                ) : null
              )}
            </select>

            <select
              value={tabs.find((tab) => tab.id === activeTab)?.timeframe || ""}
              onChange={(e) =>
                updateTab(activeTab, { timeframe: e.target.value })
              }
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1m">1m</option>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1h">1h</option>
              <option value="4h">4h</option>
              <option value="1d">1d</option>
            </select>

            <div className="flex bg-gray-700 rounded">
              <button
                onClick={() =>
                  updateTab(activeTab, { chartType: "candlestick" })
                }
                className={`px-3 py-1 text-sm rounded-l ${
                  tabs.find((tab) => tab.id === activeTab)?.chartType ===
                  "candlestick"
                    ? "bg-blue-500 text-white"
                    : "text-gray-300 hover:text-white hover:bg-gray-600"
                }`}
              >
                Candles
              </button>
              <button
                onClick={() => updateTab(activeTab, { chartType: "line" })}
                className={`px-3 py-1 text-sm rounded-r ${
                  tabs.find((tab) => tab.id === activeTab)?.chartType === "line"
                    ? "bg-blue-500 text-white"
                    : "text-gray-300 hover:text-white hover:bg-gray-600"
                }`}
              >
                Line
              </button>
            </div>

            <button
              onClick={() => {
                const currentTab = tabs.find((tab) => tab.id === activeTab);
                if (currentTab?.tradeId) {
                  updateChartData(currentTab.tradeId);
                }
              }}
              className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              disabled={
                isLoading[
                  tabs.find((tab) => tab.id === activeTab)?.tradeId || ""
                ]
              }
            >
              {isLoading[
                tabs.find((tab) => tab.id === activeTab)?.tradeId || ""
              ]
                ? "Refreshing..."
                : "Refresh"}
            </button>
          </div>

          <div className="text-sm text-gray-400">
            Last: <span className="text-white font-medium">24,235.50</span>
          </div>
        </div>
      )}

      {/* Chart Area */}
      <div className="flex-1 min-h-0 relative">
        <div className={`absolute inset-0 p-1 ${getLayoutClasses()}`}>
          {getVisibleTabs().map((tab) => (
            <div key={tab.id} className="relative">
              {layout !== "single" && (
                <div className="absolute top-2 left-2 z-10 bg-gray-800 px-2 py-1 rounded text-xs text-white flex items-center space-x-2">
                  <span>{getTabTitle(tab)}</span>
                  {isLoading[tab.tradeId] && (
                    <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  )}
                </div>
              )}
              <TradingViewChart
                symbol={tab.symbol}
                timeframe={tab.timeframe}
                chartType={tab.chartType}
                tradeId={tab.tradeId}
                chartData={chartData[tab.tradeId] || []}
                isLoading={isLoading[tab.tradeId] || false}
                onRefreshData={() => updateChartData(tab.tradeId)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ChartContainer;
