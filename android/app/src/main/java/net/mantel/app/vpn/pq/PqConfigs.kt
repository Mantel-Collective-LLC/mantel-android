package net.mantel.app.vpn.pq

import com.wireguard.config.Config
import com.wireguard.config.InetNetwork
import com.wireguard.config.Interface
import com.wireguard.config.Peer
import com.wireguard.crypto.Key
import com.wireguard.crypto.KeyPair
import java.net.Inet4Address

object PqConfigs {
    const val KEEPALIVE_SECONDS = 25
    val PQ_NETWORK: InetNetwork get() = InetNetwork.parse("${PqProtocol.PQ_ADDR}/32")

    class Identity(val nodeKey: Key, val clientKey: Key, val tunnelIpv4: Inet4Address)

    fun identity(base: Config): Identity {
        val peer = nodePeer(base)
        val address = base.`interface`.addresses.map { it.address }.filterIsInstance<Inet4Address>().firstOrNull()
            ?: throw IllegalArgumentException("config has no IPv4 tunnel address")
        return Identity(peer.publicKey, base.`interface`.keyPair.publicKey, address)
    }

    fun nodePeer(base: Config): Peer {
        require(base.peers.size == 1) { "PQ needs exactly one peer (the node)" }
        return base.peers[0]
    }

    fun phase1(base: Config, blackholeKey: Key = KeyPair().publicKey): Config {
        val node = nodePeer(base)
        val pq = PQ_NETWORK
        val phase1Node = Peer.Builder()
            .setPublicKey(node.publicKey)
            .addAllowedIp(pq)
            .setPersistentKeepalive(KEEPALIVE_SECONDS)
            .apply {
                node.endpoint.ifPresent { setEndpoint(it) }
                node.preSharedKey.ifPresent { setPreSharedKey(it) }
            }
            .build()
        val blackhole = Peer.Builder()
            .setPublicKey(blackholeKey)
            .addAllowedIps(node.allowedIps.filter { it != pq })
            .build()
        return Config.Builder()
            .setInterface(base.`interface`)
            .addPeer(phase1Node)
            .addPeer(blackhole)
            .build()
    }

    fun phase2(base: Config, sessionKeyPair: KeyPair, psk: Key): Config {
        val node = nodePeer(base)
        val src = base.`interface`
        val iface = Interface.Builder()
            .addAddresses(src.addresses)
            .addDnsServers(src.dnsServers)
            .addDnsSearchDomains(src.dnsSearchDomains)
            .excludeApplications(src.excludedApplications)
            .includeApplications(src.includedApplications)
            .setKeyPair(sessionKeyPair)
            .apply {
                src.listenPort.ifPresent { setListenPort(it) }
                src.mtu.ifPresent { setMtu(it) }
            }
            .build()
        val peer = Peer.Builder()
            .setPublicKey(node.publicKey)
            .setPreSharedKey(psk)
            .addAllowedIps(node.allowedIps)
            .addAllowedIp(PQ_NETWORK)
            .setPersistentKeepalive(KEEPALIVE_SECONDS)
            .apply { node.endpoint.ifPresent { setEndpoint(it) } }
            .build()
        return Config.Builder().setInterface(iface).addPeer(peer).build()
    }
}
