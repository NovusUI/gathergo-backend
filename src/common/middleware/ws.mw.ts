import { Socket } from "socket.io"
import { WsJwtGuard } from "../guards/ws-jwt.guard"
import { JwtService } from "@nestjs/jwt"


export type SocketIOMiddleware = {
    (client:Socket, next:(err? :Error)=>void)
}

export const SocketAuthMiddleware = ():SocketIOMiddleware =>{

    const jwtService = new JwtService({
        secret: process.env.JWT_SECRET,
    })

    return async(client,next)=>{

        try{
           await WsJwtGuard.extractTokenFromSocket(client,jwtService)
            next()
        }catch(error){
            next(error)
        }
    }
}