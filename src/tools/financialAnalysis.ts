import * as vscode from 'vscode';

interface FinancialAnalysisInput {
    operation: 'marketOverview' | 'stockAnalysis' | 'sectorAnalysis' | 'globalTrends' | 'technicalIndicators' | 'fundamentalAnalysis' | 'riskAssessment' | 'portfolioSuggestion' | 'newsImpact' | 'economicCalendar';
    symbol?: string;           // Stock symbol (e.g., AAPL, MSFT, TSLA)
    sector?: string;           // Sector name (e.g., Technology, Healthcare)
    region?: string;           // Region (e.g., US, China, Europe, Global)
    timeframe?: string;        // Analysis timeframe (e.g., 1D, 1W, 1M, 1Y)
    indicators?: string[];     // Technical indicators to analyze
    riskTolerance?: 'low' | 'medium' | 'high';
    investmentGoal?: string;   // Investment goal description
}

interface FinancialAnalysisResult {
    success: boolean;
    operation: string;
    data?: any;
    analysis?: string;
    recommendations?: string[];
    warnings?: string[];
    sources?: string[];
    error?: string;
}

/**
 * Financial Analysis Tool for stock market and economic analysis
 * This tool provides market insights, stock analysis, and investment guidance
 */
export class FinancialAnalysisTool implements vscode.LanguageModelTool<FinancialAnalysisInput> {

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<FinancialAnalysisInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { operation, symbol, sector, region, timeframe, indicators, riskTolerance, investmentGoal } = options.input;

        let result: FinancialAnalysisResult;

        try {
            switch (operation) {
                case 'marketOverview':
                    result = await this.getMarketOverview(region || 'Global', timeframe || '1D');
                    break;
                case 'stockAnalysis':
                    if (!symbol) {
                        result = { success: false, operation, error: 'Stock symbol is required for stock analysis' };
                    } else {
                        result = await this.analyzeStock(symbol, timeframe || '1M');
                    }
                    break;
                case 'sectorAnalysis':
                    result = await this.analyzeSector(sector || 'Technology', region || 'US');
                    break;
                case 'globalTrends':
                    result = await this.analyzeGlobalTrends(region || 'Global');
                    break;
                case 'technicalIndicators':
                    if (!symbol) {
                        result = { success: false, operation, error: 'Stock symbol is required for technical analysis' };
                    } else {
                        result = await this.getTechnicalIndicators(symbol, indicators || ['RSI', 'MACD', 'SMA']);
                    }
                    break;
                case 'fundamentalAnalysis':
                    if (!symbol) {
                        result = { success: false, operation, error: 'Stock symbol is required for fundamental analysis' };
                    } else {
                        result = await this.getFundamentalAnalysis(symbol);
                    }
                    break;
                case 'riskAssessment':
                    result = await this.assessRisk(symbol, sector, riskTolerance || 'medium');
                    break;
                case 'portfolioSuggestion':
                    result = await this.suggestPortfolio(riskTolerance || 'medium', investmentGoal || 'long-term growth');
                    break;
                case 'newsImpact':
                    result = await this.analyzeNewsImpact(symbol, sector, region || 'Global');
                    break;
                case 'economicCalendar':
                    result = await this.getEconomicCalendar(region || 'US');
                    break;
                default:
                    result = { success: false, operation, error: `Unknown operation: ${operation}` };
            }
        } catch (error) {
            result = {
                success: false,
                operation,
                error: error instanceof Error ? error.message : String(error)
            };
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2))
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<FinancialAnalysisInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { operation, symbol, sector, region } = options.input;

        let message = `Financial Analysis: ${operation}`;
        if (symbol) message += ` for ${symbol}`;
        if (sector) message += ` in ${sector} sector`;
        if (region) message += ` (${region})`;

        return {
            invocationMessage: message
        };
    }

    /**
     * Get market overview for a specific region
     */
    private async getMarketOverview(region: string, timeframe: string): Promise<FinancialAnalysisResult> {
        // This provides a framework for market analysis
        // In production, this would integrate with financial APIs (Alpha Vantage, Yahoo Finance, etc.)

        const marketData = {
            region,
            timeframe,
            majorIndices: this.getMajorIndices(region),
            marketSentiment: 'Analysis requires real-time data integration',
            tradingVolume: 'Requires API integration',
            volatilityIndex: 'VIX data requires financial API',
            analysisPrompt: `Analyze the current ${region} market conditions for ${timeframe} timeframe. Consider major indices performance, market sentiment, and key economic factors.`
        };

        return {
            success: true,
            operation: 'marketOverview',
            data: marketData,
            analysis: `Market overview framework for ${region}. For real-time data, integrate with financial APIs like Alpha Vantage, Yahoo Finance, or Bloomberg.`,
            recommendations: [
                'Monitor major index movements',
                'Track volatility indicators (VIX)',
                'Watch for central bank announcements',
                'Consider sector rotation patterns'
            ],
            sources: ['Market indices', 'Economic calendars', 'Central bank communications']
        };
    }

    /**
     * Analyze a specific stock
     */
    private async analyzeStock(symbol: string, timeframe: string): Promise<FinancialAnalysisResult> {
        return {
            success: true,
            operation: 'stockAnalysis',
            data: {
                symbol: symbol.toUpperCase(),
                timeframe,
                analysisFramework: {
                    priceAction: 'Requires real-time price data',
                    volume: 'Requires volume data',
                    movingAverages: ['SMA 20', 'SMA 50', 'SMA 200'],
                    keyLevels: 'Support and resistance levels',
                    earnings: 'Upcoming earnings date and estimates',
                    dividends: 'Dividend yield and history'
                }
            },
            analysis: `Stock analysis framework for ${symbol.toUpperCase()}. This tool provides the structure for comprehensive stock analysis. For real-time data, integrate with financial data providers.`,
            recommendations: [
                `Research ${symbol}'s recent earnings reports`,
                'Analyze competitor performance',
                'Review analyst ratings and price targets',
                'Check insider trading activity',
                'Monitor options flow for sentiment'
            ],
            warnings: [
                'Past performance does not guarantee future results',
                'Always conduct your own due diligence',
                'Consider your risk tolerance before investing'
            ]
        };
    }

    /**
     * Analyze a market sector
     */
    private async analyzeSector(sector: string, region: string): Promise<FinancialAnalysisResult> {
        const sectorInfo = this.getSectorInfo(sector);

        return {
            success: true,
            operation: 'sectorAnalysis',
            data: {
                sector,
                region,
                ...sectorInfo,
                analysisPoints: [
                    'Sector ETF performance',
                    'Top companies by market cap',
                    'Sector-specific economic indicators',
                    'Regulatory environment',
                    'Growth projections'
                ]
            },
            analysis: `Sector analysis framework for ${sector} in ${region}. Key factors include industry trends, competitive dynamics, and macroeconomic influences.`,
            recommendations: [
                `Monitor ${sector} ETFs for overall sector sentiment`,
                'Track leading companies as sector indicators',
                'Watch for sector-specific regulatory changes',
                'Consider sector rotation based on economic cycle'
            ]
        };
    }

    /**
     * Analyze global economic trends
     */
    private async analyzeGlobalTrends(region: string): Promise<FinancialAnalysisResult> {
        return {
            success: true,
            operation: 'globalTrends',
            data: {
                region,
                keyIndicators: [
                    'GDP Growth Rates',
                    'Inflation (CPI/PPI)',
                    'Interest Rates',
                    'Employment Data',
                    'Trade Balance',
                    'Currency Strength'
                ],
                geopoliticalFactors: [
                    'Trade relations',
                    'Central bank policies',
                    'Political stability',
                    'Commodity prices',
                    'Supply chain dynamics'
                ],
                currentThemes: [
                    'AI and Technology Revolution',
                    'Energy Transition',
                    'Deglobalization Trends',
                    'Demographic Shifts',
                    'Digital Currency Adoption'
                ]
            },
            analysis: `Global trends analysis focusing on ${region}. Consider macroeconomic indicators, geopolitical developments, and emerging themes.`,
            recommendations: [
                'Diversify across regions and asset classes',
                'Monitor central bank policy shifts',
                'Track commodity price movements',
                'Consider currency hedging for international exposure',
                'Stay informed on geopolitical developments'
            ]
        };
    }

    /**
     * Get technical indicators for a stock
     */
    private async getTechnicalIndicators(symbol: string, indicators: string[]): Promise<FinancialAnalysisResult> {
        const indicatorDescriptions: Record<string, string> = {
            'RSI': 'Relative Strength Index - Momentum oscillator (0-100). Overbought >70, Oversold <30',
            'MACD': 'Moving Average Convergence Divergence - Trend-following momentum indicator',
            'SMA': 'Simple Moving Average - Average price over specified period',
            'EMA': 'Exponential Moving Average - Weighted average giving more weight to recent prices',
            'BB': 'Bollinger Bands - Volatility indicator with upper/middle/lower bands',
            'ADX': 'Average Directional Index - Trend strength indicator',
            'STOCH': 'Stochastic Oscillator - Momentum indicator comparing closing price to price range',
            'ATR': 'Average True Range - Volatility indicator',
            'OBV': 'On-Balance Volume - Volume-based momentum indicator',
            'VWAP': 'Volume Weighted Average Price - Benchmark price level'
        };

        return {
            success: true,
            operation: 'technicalIndicators',
            data: {
                symbol: symbol.toUpperCase(),
                requestedIndicators: indicators,
                indicatorDescriptions: indicators.map(ind => ({
                    indicator: ind,
                    description: indicatorDescriptions[ind.toUpperCase()] || 'Custom indicator'
                })),
                interpretation: 'Technical indicators require real-time price data for accurate signals'
            },
            analysis: `Technical analysis framework for ${symbol.toUpperCase()} using ${indicators.join(', ')}. Combine multiple indicators for confirmation signals.`,
            recommendations: [
                'Use multiple indicators for confirmation',
                'Consider the broader trend before acting on signals',
                'Set proper stop-losses based on ATR',
                'Watch for divergences between price and indicators'
            ]
        };
    }

    /**
     * Get fundamental analysis for a stock
     */
    private async getFundamentalAnalysis(symbol: string): Promise<FinancialAnalysisResult> {
        return {
            success: true,
            operation: 'fundamentalAnalysis',
            data: {
                symbol: symbol.toUpperCase(),
                metricsToAnalyze: {
                    valuation: ['P/E Ratio', 'P/B Ratio', 'P/S Ratio', 'EV/EBITDA', 'PEG Ratio'],
                    profitability: ['Gross Margin', 'Operating Margin', 'Net Margin', 'ROE', 'ROA', 'ROIC'],
                    growth: ['Revenue Growth', 'Earnings Growth', 'Free Cash Flow Growth'],
                    financialHealth: ['Debt/Equity', 'Current Ratio', 'Quick Ratio', 'Interest Coverage'],
                    efficiency: ['Asset Turnover', 'Inventory Turnover', 'Receivables Turnover'],
                    dividends: ['Dividend Yield', 'Payout Ratio', 'Dividend Growth Rate']
                },
                qualitativeFactors: [
                    'Management quality and track record',
                    'Competitive advantages (moat)',
                    'Industry position and market share',
                    'Growth runway and TAM',
                    'ESG considerations'
                ]
            },
            analysis: `Fundamental analysis framework for ${symbol.toUpperCase()}. Evaluate both quantitative metrics and qualitative factors for a complete picture.`,
            recommendations: [
                'Compare metrics to industry peers',
                'Look for consistent growth over multiple years',
                'Assess management capital allocation decisions',
                'Consider the competitive landscape',
                'Review recent earnings calls and guidance'
            ]
        };
    }

    /**
     * Assess investment risk
     */
    private async assessRisk(symbol: string | undefined, sector: string | undefined, riskTolerance: string): Promise<FinancialAnalysisResult> {
        const riskFramework = {
            low: {
                maxEquityAllocation: '40%',
                preferredAssets: ['Investment-grade bonds', 'Blue-chip dividend stocks', 'Money market funds'],
                volatilityTolerance: 'Max 10% drawdown acceptable'
            },
            medium: {
                maxEquityAllocation: '70%',
                preferredAssets: ['Diversified index funds', 'Growth stocks', 'Corporate bonds'],
                volatilityTolerance: 'Max 20% drawdown acceptable'
            },
            high: {
                maxEquityAllocation: '90%+',
                preferredAssets: ['Growth stocks', 'Small caps', 'Emerging markets', 'Crypto exposure'],
                volatilityTolerance: 'Can withstand 30%+ drawdowns'
            }
        };

        return {
            success: true,
            operation: 'riskAssessment',
            data: {
                subject: symbol || sector || 'General portfolio',
                riskTolerance,
                framework: riskFramework[riskTolerance as keyof typeof riskFramework],
                riskFactors: [
                    'Market risk (systematic)',
                    'Company-specific risk (unsystematic)',
                    'Interest rate risk',
                    'Currency risk',
                    'Liquidity risk',
                    'Inflation risk',
                    'Geopolitical risk'
                ]
            },
            analysis: `Risk assessment for ${riskTolerance} risk tolerance. Consider diversification and position sizing to manage risk.`,
            recommendations: [
                'Diversify across uncorrelated assets',
                'Use stop-losses to limit downside',
                'Size positions based on conviction and risk',
                'Regularly rebalance portfolio',
                'Keep emergency fund separate from investments'
            ],
            warnings: [
                'All investments carry risk of loss',
                'Past volatility may not predict future volatility',
                'Consider your investment timeline'
            ]
        };
    }

    /**
     * Suggest portfolio allocation
     */
    private async suggestPortfolio(riskTolerance: string, investmentGoal: string): Promise<FinancialAnalysisResult> {
        const allocations = {
            low: {
                'US Large Cap': '20%',
                'International Developed': '10%',
                'US Bonds': '40%',
                'International Bonds': '10%',
                'REITs': '5%',
                'Cash/Money Market': '15%'
            },
            medium: {
                'US Large Cap': '35%',
                'US Small/Mid Cap': '10%',
                'International Developed': '15%',
                'Emerging Markets': '5%',
                'US Bonds': '20%',
                'International Bonds': '5%',
                'REITs': '5%',
                'Cash': '5%'
            },
            high: {
                'US Large Cap': '30%',
                'US Small/Mid Cap': '15%',
                'International Developed': '15%',
                'Emerging Markets': '15%',
                'US Growth': '10%',
                'Sector Bets': '5%',
                'Bonds': '5%',
                'Alternatives': '5%'
            }
        };

        return {
            success: true,
            operation: 'portfolioSuggestion',
            data: {
                riskTolerance,
                investmentGoal,
                suggestedAllocation: allocations[riskTolerance as keyof typeof allocations],
                etfExamples: {
                    'US Large Cap': 'VOO, SPY, IVV',
                    'US Small/Mid Cap': 'VXF, IJH, VB',
                    'International Developed': 'VEA, IEFA, EFA',
                    'Emerging Markets': 'VWO, IEMG, EEM',
                    'US Bonds': 'BND, AGG, SCHZ',
                    'REITs': 'VNQ, IYR, SCHH'
                }
            },
            analysis: `Portfolio suggestion for ${riskTolerance} risk tolerance with goal: ${investmentGoal}. This is a starting framework - adjust based on personal circumstances.`,
            recommendations: [
                'Review and rebalance quarterly or annually',
                'Consider tax implications (use tax-advantaged accounts)',
                'Dollar-cost average into positions',
                'Increase bond allocation as you near retirement',
                'Consider target-date funds for simplicity'
            ],
            warnings: [
                'This is educational content, not financial advice',
                'Consult a financial advisor for personalized recommendations',
                'Your situation may require different allocation'
            ]
        };
    }

    /**
     * Analyze news impact on investments
     */
    private async analyzeNewsImpact(symbol: string | undefined, sector: string | undefined, region: string): Promise<FinancialAnalysisResult> {
        return {
            success: true,
            operation: 'newsImpact',
            data: {
                subject: symbol || sector || 'General market',
                region,
                newsCategories: [
                    'Earnings announcements',
                    'Central bank decisions',
                    'Economic data releases',
                    'Geopolitical events',
                    'Industry-specific news',
                    'Regulatory changes',
                    'M&A activity',
                    'Analyst upgrades/downgrades'
                ],
                impactAssessment: 'Requires real-time news feed integration',
                sentimentAnalysis: 'Requires NLP processing of news articles'
            },
            analysis: `News impact analysis framework for ${symbol || sector || 'market'}. Monitor multiple news sources and assess both immediate and long-term implications.`,
            recommendations: [
                'Use news aggregators for comprehensive coverage',
                'Distinguish between noise and signal',
                'Consider the source credibility',
                'Watch for earnings surprises and guidance changes',
                'Monitor social sentiment as contrarian indicator'
            ],
            sources: [
                'Financial news outlets (Bloomberg, Reuters, CNBC)',
                'Company press releases',
                'SEC filings (10-K, 10-Q, 8-K)',
                'Analyst reports',
                'Social media sentiment'
            ]
        };
    }

    /**
     * Get economic calendar events
     */
    private async getEconomicCalendar(region: string): Promise<FinancialAnalysisResult> {
        const keyEvents: Record<string, string[]> = {
            'US': [
                'FOMC Interest Rate Decision',
                'Non-Farm Payrolls (NFP)',
                'CPI/PPI Inflation Data',
                'GDP Reports',
                'Retail Sales',
                'PMI (Manufacturing/Services)',
                'Initial Jobless Claims',
                'Consumer Confidence'
            ],
            'Europe': [
                'ECB Interest Rate Decision',
                'Eurozone GDP',
                'German IFO Business Climate',
                'Eurozone CPI',
                'PMI Reports'
            ],
            'China': [
                'PBOC Rate Decisions',
                'GDP Growth',
                'PMI (Caixin/Official)',
                'Trade Balance',
                'Industrial Production'
            ],
            'Global': [
                'G7/G20 Summits',
                'OPEC Meetings',
                'WTO Announcements',
                'IMF/World Bank Reports'
            ]
        };

        return {
            success: true,
            operation: 'economicCalendar',
            data: {
                region,
                keyEvents: keyEvents[region] || keyEvents['Global'],
                marketMovingEvents: [
                    'Central bank decisions (highest impact)',
                    'Employment data',
                    'Inflation reports',
                    'GDP releases'
                ],
                tradingStrategy: 'Consider reducing position sizes before major events'
            },
            analysis: `Economic calendar framework for ${region}. High-impact events can cause significant market volatility.`,
            recommendations: [
                'Mark key dates on your calendar',
                'Review expectations vs actual results',
                'Be cautious trading around major events',
                'Understand the lagging vs leading indicators',
                'Watch for revisions to previous data'
            ]
        };
    }

    /**
     * Get major indices for a region
     */
    private getMajorIndices(region: string): string[] {
        const indices: Record<string, string[]> = {
            'US': ['S&P 500', 'Dow Jones', 'NASDAQ', 'Russell 2000'],
            'Europe': ['FTSE 100', 'DAX', 'CAC 40', 'Euro Stoxx 50'],
            'Asia': ['Nikkei 225', 'Hang Seng', 'Shanghai Composite', 'KOSPI'],
            'China': ['Shanghai Composite', 'Shenzhen Component', 'CSI 300', 'Hang Seng'],
            'Global': ['MSCI World', 'MSCI ACWI', 'FTSE Global All Cap']
        };
        return indices[region] || indices['Global'];
    }

    /**
     * Get sector information
     */
    private getSectorInfo(sector: string): any {
        const sectorData: Record<string, any> = {
            'Technology': {
                keyCompanies: ['Apple', 'Microsoft', 'Google', 'NVIDIA', 'Meta'],
                etfs: ['XLK', 'VGT', 'QQQ'],
                drivers: ['AI adoption', 'Cloud growth', 'Digital transformation'],
                risks: ['Regulation', 'Valuation', 'Competition']
            },
            'Healthcare': {
                keyCompanies: ['UnitedHealth', 'Johnson & Johnson', 'Pfizer', 'Eli Lilly'],
                etfs: ['XLV', 'VHT', 'IBB'],
                drivers: ['Aging population', 'Innovation', 'GLP-1 drugs'],
                risks: ['Drug pricing', 'Clinical trial failures', 'Regulation']
            },
            'Financials': {
                keyCompanies: ['JPMorgan', 'Bank of America', 'Berkshire Hathaway', 'Visa'],
                etfs: ['XLF', 'VFH', 'KRE'],
                drivers: ['Interest rates', 'Economic growth', 'Credit quality'],
                risks: ['Recession', 'Credit losses', 'Regulation']
            },
            'Energy': {
                keyCompanies: ['ExxonMobil', 'Chevron', 'Shell', 'NextEra Energy'],
                etfs: ['XLE', 'VDE', 'OIH'],
                drivers: ['Oil prices', 'Energy transition', 'Geopolitics'],
                risks: ['Price volatility', 'Transition risk', 'ESG concerns']
            },
            'Consumer': {
                keyCompanies: ['Amazon', 'Walmart', 'Costco', 'Nike'],
                etfs: ['XLY', 'XLP', 'VCR'],
                drivers: ['Consumer spending', 'E-commerce', 'Brand strength'],
                risks: ['Recession', 'Inflation', 'Competition']
            }
        };
        return sectorData[sector] || { info: 'Sector data not available', suggestion: 'Research sector-specific ETFs and leading companies' };
    }
}
