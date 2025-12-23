@echo off
echo 🚀 Setting up Real-Time Impact Analyzer VS Code Extension...
echo.

REM Check if we're in the right directory
if not exist "package.json" (
    echo ❌ Error: Please run this script from the vscode-extension directory
    exit /b 1
)

REM Install dependencies
echo 📦 Installing dependencies...
npm install
if %errorlevel% neq 0 (
    echo ❌ Failed to install dependencies
    exit /b 1
)

REM Compile TypeScript
echo 🔨 Compiling TypeScript...
npm run compile
if %errorlevel% neq 0 (
    echo ❌ Compilation failed
    exit /b 1
)

echo.
echo ✅ Extension setup completed successfully!
echo.
echo 🎯 Next steps:
echo 1. Open VS Code in this directory: code .
echo 2. Press F5 to run the extension in development mode
echo 3. Test the extension with a project that has test files
echo.
echo 📋 Available commands:
echo   - Ctrl+Shift+I: Analyze current file impact
echo   - Ctrl+Shift+T: Run affected tests
echo   - AutoTest: Analyze Workspace
echo   - AutoTest: Run Pre-Commit Tests
echo.
echo 🔧 Configuration:
echo   - Open VS Code settings (Ctrl+,)
echo   - Search for 'impactAnalyzer'
echo   - Configure test frameworks and patterns
echo.
echo 📖 For more information, see README.md
echo.
pause