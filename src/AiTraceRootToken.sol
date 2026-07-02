// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract AiTraceRootToken is ERC20Burnable, Ownable2Step {
    error ZeroAddress();

    event Burn(address indexed from, uint256 amount);

    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 * 10 ** 18;

    constructor(address initialOwner) ERC20("AiTraceRoot", "ART") {
        if (initialOwner == address(0)) {
            revert ZeroAddress();
        }

        _mint(initialOwner, INITIAL_SUPPLY);
        _transferOwnership(initialOwner);
    }

    function getOwner() external view returns (address) {
        return owner();
    }

    function transferOwnership2Step(address newOwner) external onlyOwner {
        transferOwnership(newOwner);
    }

    function burn(uint256 amount) public override {
        super.burn(amount);
        emit Burn(_msgSender(), amount);
    }

    function burnFrom(address account, uint256 amount) public override {
        super.burnFrom(account, amount);
        emit Burn(account, amount);
    }
}
