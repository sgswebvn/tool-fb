import { Application } from "express";

declare module "socket.io" {
    interface Socket {
        app: Application;
    }
}