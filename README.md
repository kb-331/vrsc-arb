# Node.js Arbitrage Monitor

A robust, production-grade cryptocurrency arbitrage monitoring system built with Node.js.

## Features

- Real-time price monitoring across multiple exchanges
- Advanced arbitrage opportunity detection
- Risk management system
- Health monitoring
- Performance tracking
- Configurable trading strategies

## Prerequisites

- Node.js 18 or higher
- npm 9 or higher

## Installation

```bash
npm install
```

## Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Update the environment variables in `.env` with your settings.

## Usage

Start the development server:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

## Project Structure

```
├── config/                 # Configuration files
├── src/
│   ├── arbitrage/         # Arbitrage detection and execution
│   ├── exchanges/         # Exchange connectors
│   ├── health/           # System health monitoring
│   ├── monitoring/       # Price and performance monitoring
│   ├── orders/           # Order management
│   ├── position/         # Position management
│   ├── price/           # Price feed management
│   ├── risk/            # Risk management
│   ├── strategy/        # Trading strategy engine
│   └── utils/           # Utility functions
├── tests/                # Test files
└── package.json
```

## License

MIT