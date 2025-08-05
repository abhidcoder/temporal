#!/bin/bash

# Deployment script for Temporal Sync Project
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if .env file exists
if [ ! -f .env ]; then
    print_error ".env file not found. Please create one based on .env.example"
    exit 1
fi

# Load environment variables
source .env

# Function to deploy with Docker Compose
deploy_docker_compose() {
    print_status "Deploying with Docker Compose..."
    
    # Build and start services
    docker-compose build
    docker-compose up -d
    
    print_status "Services started. Checking health..."
    
    # Wait for services to be ready
    sleep 10
    
    # Check if services are running
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        print_status "Application is healthy!"
    else
        print_warning "Application health check failed. Check logs with: docker-compose logs"
    fi
}

# Function to deploy with PM2
deploy_pm2() {
    print_status "Deploying with PM2..."
    
    # Install dependencies
    npm ci --only=production
    
    # Create logs directory
    mkdir -p logs
    
    # Start applications with PM2
    pm2 start ecosystem.config.js --env production
    
    # Save PM2 configuration
    pm2 save
    
    print_status "PM2 deployment completed!"
    print_status "Monitor with: pm2 monit"
}

# Function to deploy to Kubernetes
deploy_kubernetes() {
    print_status "Deploying to Kubernetes..."
    
    # Check if kubectl is available
    if ! command -v kubectl &> /dev/null; then
        print_error "kubectl is not installed or not in PATH"
        exit 1
    fi
    
    # Build Docker image
    docker build -t temporal-sync:latest .
    
    # Apply Kubernetes manifests
    kubectl apply -f k8s/
    
    print_status "Kubernetes deployment completed!"
    print_status "Check status with: kubectl get pods -n temporal-sync"
}

# Function to stop services
stop_services() {
    print_status "Stopping services..."
    
    case $1 in
        "docker")
            docker-compose down
            print_status "Docker services stopped"
            ;;
        "pm2")
            pm2 stop all
            print_status "PM2 services stopped"
            ;;
        "k8s")
            kubectl delete -f k8s/
            print_status "Kubernetes services stopped"
            ;;
        *)
            print_error "Unknown deployment type: $1"
            exit 1
            ;;
    esac
}

# Function to show logs
show_logs() {
    case $1 in
        "docker")
            docker-compose logs -f
            ;;
        "pm2")
            pm2 logs
            ;;
        "k8s")
            kubectl logs -f deployment/temporal-sync-server -n temporal-sync
            ;;
        *)
            print_error "Unknown deployment type: $1"
            exit 1
            ;;
    esac
}

# Function to show status
show_status() {
    case $1 in
        "docker")
            docker-compose ps
            ;;
        "pm2")
            pm2 status
            ;;
        "k8s")
            kubectl get pods -n temporal-sync
            ;;
        *)
            print_error "Unknown deployment type: $1"
            exit 1
            ;;
    esac
}

# Main script logic
case $1 in
    "docker")
        deploy_docker_compose
        ;;
    "pm2")
        deploy_pm2
        ;;
    "k8s")
        deploy_kubernetes
        ;;
    "stop")
        if [ -z "$2" ]; then
            print_error "Please specify deployment type: docker, pm2, or k8s"
            exit 1
        fi
        stop_services $2
        ;;
    "logs")
        if [ -z "$2" ]; then
            print_error "Please specify deployment type: docker, pm2, or k8s"
            exit 1
        fi
        show_logs $2
        ;;
    "status")
        if [ -z "$2" ]; then
            print_error "Please specify deployment type: docker, pm2, or k8s"
            exit 1
        fi
        show_status $2
        ;;
    *)
        echo "Usage: $0 {docker|pm2|k8s|stop <type>|logs <type>|status <type>}"
        echo ""
        echo "Commands:"
        echo "  docker    - Deploy using Docker Compose"
        echo "  pm2       - Deploy using PM2"
        echo "  k8s       - Deploy to Kubernetes"
        echo "  stop      - Stop services (specify type: docker|pm2|k8s)"
        echo "  logs      - Show logs (specify type: docker|pm2|k8s)"
        echo "  status    - Show status (specify type: docker|pm2|k8s)"
        echo ""
        echo "Examples:"
        echo "  $0 docker"
        echo "  $0 pm2"
        echo "  $0 stop docker"
        echo "  $0 logs pm2"
        exit 1
        ;;
esac 