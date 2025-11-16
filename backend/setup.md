# Backend Setup Instructions

## Manual Installation

### 1. Initialize Project (if starting from scratch)

```bash
npm init -y
npm install -g @nestjs/cli
```

### 2. Install Dependencies

#### Core NestJS packages:
```bash
npm install @nestjs/common @nestjs/core @nestjs/platform-express
npm install @nestjs/typeorm @nestjs/jwt @nestjs/passport
npm install @nestjs/schedule @nestjs/mapped-types
```

#### Authentication:
```bash
npm install passport passport-jwt passport-local bcrypt
```

#### Database:
```bash
npm install typeorm pg
```

#### Validation and utilities:
```bash
npm install class-validator class-transformer axios reflect-metadata rxjs
```

#### Development dependencies:
```bash
npm install --save-dev @nestjs/cli @nestjs/schematics @nestjs/testing
npm install --save-dev @types/express @types/jest @types/node
npm install --save-dev @types/passport-jwt @types/passport-local @types/bcrypt
npm install --save-dev @typescript-eslint/eslint-plugin @typescript-eslint/parser
npm install --save-dev eslint eslint-config-prettier eslint-plugin-prettier
npm install --save-dev jest prettier source-map-support ts-jest ts-loader ts-node tsconfig-paths typescript
```

### 3. Setup Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 4. Run the Application

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## Using Installation Script

```bash
chmod +x install.sh
./install.sh
```

