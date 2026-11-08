package net.mantel.app.vpn.pq

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.SystemClock
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket

class VpnSocketTransport(
    context: Context,
    private val tunnelIpv4: Inet4Address,
    private val checkCancelled: () -> Unit = {},
) : PqTransport {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val target = InetSocketAddress(InetAddress.getByAddress(PqProtocol.PQ_ADDR.let(PqCrypto::ipv4Bytes)), PqProtocol.PQ_PORT)

    override fun roundTrip(request: ByteArray, connectTimeoutMs: Int, readTimeoutMs: Int): ByteArray {
        val network = awaitVpnNetwork(connectTimeoutMs.toLong())
        Socket().use { socket ->
            network.bindSocket(socket)
            socket.bind(InetSocketAddress(tunnelIpv4, 0))
            socket.connect(target, connectTimeoutMs)
            if (socket.localAddress != tunnelIpv4) throw IOException("socket not bound to the tunnel address")
            socket.tcpNoDelay = true
            socket.soTimeout = readTimeoutMs
            socket.getOutputStream().apply {
                write(request)
                flush()
            }
            return PqProtocol.readFrame(socket.getInputStream())
        }
    }

    private fun awaitVpnNetwork(timeoutMs: Long): Network {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (true) {
            findVpnNetwork()?.let { return it }
            if (SystemClock.elapsedRealtime() >= deadline) throw IOException("VPN network not available")
            checkCancelled()
            Thread.sleep(100)
        }
    }

    private fun findVpnNetwork(): Network? {
        val cm = connectivity ?: return null
        @Suppress("DEPRECATION")
        for (network in cm.allNetworks) {
            val caps = cm.getNetworkCapabilities(network) ?: continue
            if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
            val addresses = cm.getLinkProperties(network)?.linkAddresses ?: continue
            if (addresses.any { it.address == tunnelIpv4 }) return network
        }
        return null
    }
}
