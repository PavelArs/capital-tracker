# Frontend Setup Instructions

## Manual Installation

### 1. Initialize Project (if starting from scratch)

```bash
npm init -y
```

### 2. Install Dependencies

#### React and routing:
```bash
npm install react react-dom react-router-dom
```

#### HTTP client and utilities:
```bash
npm install axios
```

#### Charts:
```bash
npm install chart.js react-chartjs-2
```

#### Date utilities:
```bash
npm install date-fns
```

#### Development dependencies:
```bash
npm install --save-dev @types/react @types/react-dom
npm install --save-dev @vitejs/plugin-react typescript vite
```

### 3. Setup Environment

```bash
cp .env.example .env
# Edit .env with your API URL if needed
```

### 4. Run the Application

```bash
# Development
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Using Installation Script

```bash
chmod +x install.sh
./install.sh
```

